"""Every Planning operation, and the only place that writes a work item.

A caller names an item by its UUID or by what a person types — `VAL-142` — and
gets the same record either way. Writes go through one guarded path that names
the revision it read, bumps it, and records what happened; that is why the event
trace can be read as the truth rather than as a best effort, and why two agents
cannot both be handed one item.

What a caller sees is `read_model`, next door: the identity lookups and the shape
of the record. A field appearing in a payload is not a new rule about who may
write, so the two change for different reasons, and the dependency runs one way —
this module reads from there, and nothing there writes.
"""

from __future__ import annotations

import sqlite3

from . import model, read_model, store, transitions

_NOW = "strftime('%Y-%m-%dT%H:%M:%SZ','now')"

#: How many candidates the take-next queue will try before reporting the race it
#: keeps losing. Bounded rather than open-ended because a caller inside its own
#: older transaction would otherwise be offered the same item forever.
_READY_CLAIM_ATTEMPTS = 8


# -- reading -----------------------------------------------------------------


def list_planning_spaces(conn: sqlite3.Connection) -> list[dict]:
    spaces = []
    for row in conn.execute("SELECT * FROM planning_spaces ORDER BY name"):
        counts = _space_counts(conn, str(row["planning_space_id"]))
        spaces.append(
            {
                "planning_space_id": row["planning_space_id"],
                "project_id": row["project_id"],
                "name": row["name"],
                "key": row["key"],
                "provider_kind": row["provider_kind"],
                "work_items": counts["total"],
                "open": counts["open"],
                "active": counts["active"],
                "completed": counts["completed"],
                "updated_at": row["updated_at"],
            }
        )
    return spaces


def get_planning_space(conn: sqlite3.Connection, reference: str) -> dict:
    """One space, by id, key or name — whichever the caller has."""

    row = _space_row(conn, reference)
    workflow = store.workflow_for_space(conn, str(row["planning_space_id"]))
    return {
        "planning_space_id": row["planning_space_id"],
        "project_id": row["project_id"],
        "name": row["name"],
        "key": row["key"],
        "provider_kind": row["provider_kind"],
        "workflow": _workflow_payload(conn, workflow),
    }


def get_work_item(conn: sqlite3.Connection, reference: str) -> dict:
    return read_model.present(conn, read_model.item_row(conn, reference), full=True)


def list_work_items(
    conn: sqlite3.Connection,
    *,
    space: str | None = None,
    state_key: str | None = None,
    category: str | None = None,
    kind: str | None = None,
    owner: str | None = None,
    limit: int = 200,
) -> list[dict]:
    clauses: list[str] = []
    parameters: list[object] = []
    if space is not None:
        clauses.append("i.planning_space_id = ?")
        parameters.append(str(_space_row(conn, space)["planning_space_id"]))
    if state_key is not None:
        clauses.append("s.key = ?")
        parameters.append(model.state_key(state_key))
    if category is not None:
        clauses.append("s.category = ?")
        parameters.append(model.state_category(category))
    if kind is not None:
        clauses.append("i.kind = ?")
        parameters.append(model.work_item_kind(kind))
    if owner is not None:
        clauses.append("i.claim_ref = ?")
        parameters.append(model.actor(owner, "owner"))
    bounded = max(1, min(int(limit), 1000))
    query = with_clauses(
        "SELECT i.* FROM work_items i JOIN workflow_states s ON s.state_id = i.state_id", clauses
    )
    query += " ORDER BY s.position, i.position, i.number LIMIT ?"
    rows = conn.execute(query, (*parameters, bounded)).fetchall()
    return [read_model.present(conn, row) for row in rows]


def search_work_items(
    conn: sqlite3.Connection, query: str, *, space: str | None = None, limit: int = 50
) -> list[dict]:
    """Items whose text, labels, source, summary or comments carry the query.

    A comment counts: an item is often findable only by what somebody wrote
    under it, and a hit there is reported as the matching line rather than as a
    bare row, so the reader can see why the item came back.
    """

    text = model.text_field(query, "query", limit=200)
    like = f"%{text}%"
    parameters: list[object] = [like]
    clauses = [
        "(i.title LIKE ? OR i.description LIKE ? OR i.labels LIKE ? OR i.source LIKE ?"
        " OR i.summary LIKE ?"
        " OR EXISTS (SELECT 1 FROM work_item_comments m"
        "  WHERE m.work_item_id = i.work_item_id AND m.body LIKE ?))"
    ]
    parameters.extend([like] * 6)
    if space is not None:
        clauses.append("i.planning_space_id = ?")
        parameters.append(str(_space_row(conn, space)["planning_space_id"]))
    query = with_clauses(
        "SELECT i.*, ("
        "  SELECT m.body FROM work_item_comments m"
        "  WHERE m.work_item_id = i.work_item_id AND m.body LIKE ?"
        "  ORDER BY m.id DESC LIMIT 1"
        " ) AS comment_hit"
        " FROM work_items i JOIN workflow_states s ON s.state_id = i.state_id",
        clauses,
    )
    query += " ORDER BY i.updated_at DESC LIMIT ?"
    rows = conn.execute(query, (*parameters, max(1, min(int(limit), 200)))).fetchall()
    found = []
    for row in rows:
        item = read_model.present(conn, row)
        if row["comment_hit"]:
            item["comment_hit"] = str(row["comment_hit"])[:240]
        if text.lower() in str(row["summary"] or "").lower():
            item["summary_hit"] = True
        found.append(item)
    return found


# -- writing -----------------------------------------------------------------


def create_planning_space(
    conn: sqlite3.Connection, *, project_id: str, name: str, key: str | None = None
) -> dict:
    space = store.create_space(conn, project_id=project_id, name=name, key=key)
    return get_planning_space(conn, space["planning_space_id"])


def create_work_item(
    conn: sqlite3.Connection,
    *,
    space: str,
    title: str,
    state: str | None = None,
    kind: str = "task",
    priority: str = "medium",
    description: str = "",
    labels: object = None,
    source: str = "",
    parent: str | None = None,
    author: str | None = None,
) -> dict:
    space_row = _space_row(conn, space)
    space_id = str(space_row["planning_space_id"])
    workflow = store.workflow_for_space(conn, space_id)
    target = (
        _state_row(conn, str(workflow["workflow_id"]), state)
        if state
        else read_model.state_by_id(conn, str(workflow["initial_state_id"]))
    )
    parent_row = read_model.item_row(conn, parent) if parent else None
    if parent_row is not None:
        if str(parent_row["planning_space_id"]) != space_id:
            raise model.PlanningError("a parent work item lives in another planning space")
        if parent_row["parent_id"]:
            raise model.PlanningError("a work item hierarchy is one level deep")
    item_id = model.new_id()
    number = store.next_number(conn, space_id)
    position = _tail_position(conn, space_id, str(target["state_id"]))
    conn.execute(
        "INSERT INTO work_items(work_item_id,planning_space_id,number,workflow_id,state_id,kind,"
        "parent_id,priority,title,description,labels,source,position)"
        " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            item_id,
            space_id,
            number,
            str(workflow["workflow_id"]),
            str(target["state_id"]),
            model.work_item_kind(kind),
            str(parent_row["work_item_id"]) if parent_row is not None else None,
            model.priority(priority),
            model.text_field(title, "work_item.title"),
            model.multiline_field(description, "work_item.description"),
            model.dumps(model.labels(labels)),
            model.text_field(source, "work_item.source", limit=512, required=False),
            position,
        ),
    )
    _log(conn, item_id, "created", str(target["key"]), author)
    return read_model.present(conn, read_model.item_by_id(conn, item_id), full=True)


def update_work_item(
    conn: sqlite3.Connection,
    reference: str,
    *,
    title: str | None = None,
    description: str | None = None,
    source: str | None = None,
    priority: str | None = None,
    labels: object = None,
    kind: str | None = None,
    parent: str | None = None,
    expected_revision: int | None = None,
    author: str | None = None,
) -> dict:
    row = read_model.item_row(conn, reference)
    _require_revision(row, expected_revision)
    updates: list[str] = []
    parameters: list[object] = []
    if title is not None:
        updates.append("title = ?")
        parameters.append(model.text_field(title, "work_item.title"))
    if description is not None:
        updates.append("description = ?")
        parameters.append(model.multiline_field(description, "work_item.description"))
    if source is not None:
        updates.append("source = ?")
        parameters.append(model.text_field(source, "work_item.source", limit=512, required=False))
    if priority is not None:
        updates.append("priority = ?")
        parameters.append(model.priority(priority))
    if labels is not None:
        updates.append("labels = ?")
        parameters.append(model.dumps(model.labels(labels)))
    if kind is not None:
        updates.append("kind = ?")
        parameters.append(model.work_item_kind(kind))
    if parent is not None:
        parent_row = read_model.item_row(conn, parent) if parent else None
        if parent_row is not None and str(parent_row["work_item_id"]) == str(row["work_item_id"]):
            raise model.PlanningError("a work item cannot be its own parent")
        updates.append("parent_id = ?")
        parameters.append(str(parent_row["work_item_id"]) if parent_row is not None else None)
    if not updates:
        return read_model.present(conn, row, full=True)
    _write(conn, row, updates, parameters)
    del author  # an edit is not an audited action; the revision carries it
    return read_model.present(
        conn, read_model.item_by_id(conn, str(row["work_item_id"])), full=True
    )


def delete_work_item(conn: sqlite3.Connection, reference: str) -> dict:
    row = read_model.item_row(conn, reference)
    children = conn.execute(
        "SELECT COUNT(*) FROM work_items WHERE parent_id = ?", (str(row["work_item_id"]),)
    ).fetchone()[0]
    if children:
        raise model.PlanningError(
            f"{read_model.reference(conn, row)} still has {children} child item(s); move or delete them first"
        )
    conn.execute("DELETE FROM work_items WHERE work_item_id = ?", (str(row["work_item_id"]),))
    return {
        "work_item_id": row["work_item_id"],
        "reference": read_model.reference(conn, row),
        "deleted": True,
    }


def transition_work_item(
    conn: sqlite3.Connection,
    reference: str,
    state: str,
    *,
    reason: str = "",
    force: bool = False,
    expected_revision: int | None = None,
    author: str | None = None,
    improvement_guard: transitions.ImprovementGuard | None = None,
) -> dict:
    row = read_model.item_row(conn, reference)
    _require_revision(row, expected_revision)
    target = _state_row(conn, str(row["workflow_id"]), state)
    refusals, warnings = transitions.findings(
        conn, row, target, reason=reason, improvement_guard=improvement_guard
    )
    if refusals and not force:
        raise model.WorkflowGuardError(
            "; ".join(f"[{guard}] {message}" for guard, message in refusals)
        )
    position = _tail_position(conn, str(row["planning_space_id"]), str(target["state_id"]))
    _write(
        conn,
        row,
        ["state_id = ?", "position = ?"],
        [str(target["state_id"]), position],
    )
    detail = str(target["key"])
    if reason.strip():
        detail = f"{detail}: {model.text_field(reason, 'reason', limit=512)}"
    _log(conn, str(row["work_item_id"]), "transitioned", detail, author)
    if refusals:
        _log(
            conn,
            str(row["work_item_id"]),
            "overridden",
            "; ".join(guard for guard, _ in refusals),
            author,
        )
    answer = read_model.present(
        conn, read_model.item_by_id(conn, str(row["work_item_id"])), full=True
    )
    answer["warnings"] = warnings
    if refusals:
        answer["overridden"] = [guard for guard, _ in refusals]
    return answer


def claim_work_item(
    conn: sqlite3.Connection,
    reference: str,
    *,
    author: str | None = None,
    force: bool = False,
    release: bool = False,
    expected_revision: int | None = None,
) -> dict:
    row = read_model.item_row(conn, reference)
    _require_revision(row, expected_revision)
    actor = model.actor(author)
    held = str(row["claim_ref"] or "")
    if release:
        if held and held != actor and not force:
            raise model.PlanningError(
                f"{read_model.reference(conn, row)} is held by {held}, not by you"
            )
        _write(conn, row, ["claim_ref = ?"], [""])
        _log(conn, str(row["work_item_id"]), "released", held, author)
    elif held and held != actor:
        if not force:
            raise model.PlanningError(
                f"{read_model.reference(conn, row)} is already held by {held};"
                " pass force to take the work over"
            )
        _write(conn, row, ["claim_ref = ?"], [actor])
        _log(conn, str(row["work_item_id"]), "taken_over", held, author)
    else:
        try:
            _write(conn, row, ["claim_ref = ?"], [actor])
        except model.RevisionConflictError:
            return _claim_lost(conn, row, actor)
        _log(conn, str(row["work_item_id"]), "claimed", "", author)
    return read_model.present(
        conn, read_model.item_by_id(conn, str(row["work_item_id"])), full=True
    )


def _claim_lost(conn: sqlite3.Connection, row: sqlite3.Row, actor: str) -> dict:
    """Answer a claim that lost its race the way a claim is supposed to fail.

    What a caller is promised is that a claim fails naming the holder, not that
    it reports a revision — so the answer to losing comes from re-reading who
    holds it now. Finding one's own name there is the same outcome that was
    asked for, and saying so keeps a retry from being punished for the race it
    already won.
    """

    fresh = read_model.item_by_id(conn, str(row["work_item_id"]))
    holder = str(fresh["claim_ref"] or "")
    if holder == actor:
        return read_model.present(conn, fresh, full=True)
    if holder:
        raise model.PlanningError(
            f"{read_model.reference(conn, fresh)} is already held by {holder};"
            " pass force to take the work over"
        ) from None
    raise model.RevisionConflictError(int(row["revision"]), int(fresh["revision"])) from None


def claim_ready_work_item(
    conn: sqlite3.Connection,
    *,
    space: str | None = None,
    author: str | None = None,
) -> dict | None:
    """Pick the next unheld, unblocked item in a startable state and take it.

    Choosing and writing are two statements, so the item chosen can be taken by
    somebody else before this claim lands. The guarded write is what catches
    that, and the loser looks for the next candidate instead of being handed an
    item that is already held — which is how two agents asking at once end up
    with two different items. A caller whose own transaction still holds an
    older view keeps seeing the same candidate, so the attempts are bounded and
    the last refusal is reported rather than looped on forever.
    """

    clauses = [
        "i.claim_ref = ''",
        "s.category IN ('backlog','queued')",
        "NOT EXISTS (SELECT 1 FROM work_item_links l JOIN work_items b"
        " ON b.work_item_id = l.from_id JOIN workflow_states bs ON bs.state_id = b.state_id"
        " WHERE l.to_id = i.work_item_id AND l.kind = 'blocks' AND bs.is_terminal = 0)",
    ]
    parameters: list[object] = []
    if space is not None:
        clauses.append("i.planning_space_id = ?")
        parameters.append(str(_space_row(conn, space)["planning_space_id"]))
    query = with_clauses(
        "SELECT i.* FROM work_items i JOIN workflow_states s ON s.state_id = i.state_id", clauses
    )
    query += " ORDER BY CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1"
    query += " WHEN 'medium' THEN 2 ELSE 3 END, s.position, i.position, i.number LIMIT 1"
    actor = model.actor(author)
    lost: model.RevisionConflictError | None = None
    for _ in range(_READY_CLAIM_ATTEMPTS):
        row = conn.execute(query, tuple(parameters)).fetchone()
        if row is None:
            return None
        try:
            _write(conn, row, ["claim_ref = ?"], [actor])
        except model.RevisionConflictError as conflict:
            lost = conflict
            continue
        _log(conn, str(row["work_item_id"]), "claimed", "", author)
        return read_model.present(
            conn, read_model.item_by_id(conn, str(row["work_item_id"])), full=True
        )
    if lost is not None:
        raise lost
    raise model.PlanningError("no work item could be claimed")


def set_checklist(
    conn: sqlite3.Connection,
    reference: str,
    items: object,
    *,
    force: bool = False,
    expected_revision: int | None = None,
    author: str | None = None,
) -> dict:
    row = read_model.item_row(conn, reference)
    _require_revision(row, expected_revision)
    existing = model.checklist(row["checklist"])
    engaged = [step for step in existing if step["done"] or step["claimed_by"]]
    if engaged and not force:
        raise model.PlanningError(
            f"{read_model.reference(conn, row)} has {len(engaged)} claimed or completed step(s);"
            " pass force to discard that state explicitly"
        )
    replacement = model.checklist(items)
    _write(conn, row, ["checklist = ?"], [model.dumps(replacement)])
    _log(conn, str(row["work_item_id"]), "checklist_replaced", str(len(replacement)), author)
    return read_model.present(
        conn, read_model.item_by_id(conn, str(row["work_item_id"])), full=True
    )


def claim_checklist_item(
    conn: sqlite3.Connection,
    reference: str,
    item_id: str,
    *,
    author: str | None = None,
    force: bool = False,
    release: bool = False,
    expected_revision: int | None = None,
) -> dict:
    row = read_model.item_row(conn, reference)
    _require_revision(row, expected_revision)
    steps = model.checklist(row["checklist"])
    step = _step(steps, item_id, conn, row)
    actor = model.actor(author)
    held = step["claimed_by"]
    if release:
        if held and held != actor and not force:
            raise model.PlanningError(f"that step is held by {held}, not by you")
        step["claimed_by"] = ""
        action = "checklist_released"
    elif held and held != actor:
        if not force:
            raise model.PlanningError(
                f"that step is already held by {held}; pass force to take it over"
            )
        step["claimed_by"] = actor
        action = "checklist_taken_over"
    else:
        step["claimed_by"] = actor
        action = "checklist_claimed"
    _write(conn, row, ["checklist = ?"], [model.dumps(steps)])
    _log(conn, str(row["work_item_id"]), action, step["text"][:120], author)
    return read_model.present(
        conn, read_model.item_by_id(conn, str(row["work_item_id"])), full=True
    )


def tick_checklist_item(
    conn: sqlite3.Connection,
    reference: str,
    item_id: str,
    *,
    done: bool = True,
    author: str | None = None,
    force: bool = False,
    expected_revision: int | None = None,
) -> dict:
    row = read_model.item_row(conn, reference)
    _require_revision(row, expected_revision)
    steps = model.checklist(row["checklist"])
    step = _step(steps, item_id, conn, row)
    actor = model.actor(author)
    if step["claimed_by"] and step["claimed_by"] != actor and not force:
        raise model.PlanningError(
            f"that step is claimed by {step['claimed_by']}; pass force to complete it anyway"
        )
    step["done"] = bool(done)
    step["done_by"] = actor if done else ""
    step["claimed_by"] = "" if done else step["claimed_by"]
    _write(conn, row, ["checklist = ?"], [model.dumps(steps)])
    _log(
        conn,
        str(row["work_item_id"]),
        "checklist_completed" if done else "checklist_reopened",
        step["text"][:120],
        author,
    )
    return read_model.present(
        conn, read_model.item_by_id(conn, str(row["work_item_id"])), full=True
    )


def link_work_items(
    conn: sqlite3.Connection,
    source: str,
    target: str,
    kind: str,
    *,
    remove: bool = False,
    author: str | None = None,
) -> dict:
    from_row = read_model.item_row(conn, source)
    to_row = read_model.item_row(conn, target)
    if str(from_row["work_item_id"]) == str(to_row["work_item_id"]):
        raise model.PlanningError("a work item cannot be linked to itself")
    link = model.link_kind(kind)
    if remove:
        conn.execute(
            "DELETE FROM work_item_links WHERE from_id = ? AND to_id = ? AND kind = ?",
            (str(from_row["work_item_id"]), str(to_row["work_item_id"]), link),
        )
        action = "unlinked"
    else:
        conn.execute(
            "INSERT OR IGNORE INTO work_item_links(from_id,to_id,kind) VALUES(?,?,?)",
            (str(from_row["work_item_id"]), str(to_row["work_item_id"]), link),
        )
        action = "linked"
    detail = f"{link} {read_model.reference(conn, to_row)}"
    _log(conn, str(from_row["work_item_id"]), action, detail, author)
    _log(
        conn,
        str(to_row["work_item_id"]),
        action,
        f"{link} from {read_model.reference(conn, from_row)}",
        author,
    )
    return {
        "from": read_model.reference(conn, from_row),
        "to": read_model.reference(conn, to_row),
        "kind": link,
        "removed": remove,
    }


def attach_ref(
    conn: sqlite3.Connection,
    reference: str,
    kind: str,
    value: str,
    *,
    label: str = "",
    author: str | None = None,
) -> dict:
    row = read_model.item_row(conn, reference)
    conn.execute(
        "INSERT OR IGNORE INTO work_item_refs(work_item_id,kind,value,label,author)"
        " VALUES(?,?,?,?,?)",
        (
            str(row["work_item_id"]),
            model.ref_kind(kind),
            model.text_field(value, "work_item_ref.value", limit=512),
            model.text_field(label, "work_item_ref.label", limit=200, required=False),
            model.actor(author),
        ),
    )
    return {
        "work_item": read_model.reference(conn, row),
        "kind": model.ref_kind(kind),
        "value": value,
    }


def comment_work_item(
    conn: sqlite3.Connection, reference: str, body: str, *, author: str | None = None
) -> dict:
    row = read_model.item_row(conn, reference)
    conn.execute(
        "INSERT INTO work_item_comments(work_item_id,author,body) VALUES(?,?,?)",
        (
            str(row["work_item_id"]),
            model.actor(author),
            model.multiline_field(body, "comment.body", limit=8000),
        ),
    )
    return {
        "work_item": read_model.reference(conn, row),
        "comment_count": read_model.comment_count(conn, row),
    }


def set_summary(
    conn: sqlite3.Connection,
    reference: str,
    payload: object,
    *,
    expected_revision: int | None = None,
    author: str | None = None,
) -> dict:
    row = read_model.item_row(conn, reference)
    _require_revision(row, expected_revision)
    record = model.summary(payload)
    _write(conn, row, ["summary = ?"], [model.dumps(record)])
    _log(conn, str(row["work_item_id"]), "summarized", "", author)
    return read_model.present(
        conn, read_model.item_by_id(conn, str(row["work_item_id"])), full=True
    )


# -- internals ---------------------------------------------------------------


def with_clauses(query: str, clauses: list[str]) -> str:
    """Attach filter clauses one at a time.

    Every clause here is a literal from this module and every value travels as a
    parameter, but the statement is still assembled rather than written out, so
    it is assembled the way the rest of this repository does it: by appending
    fragments, which is also what keeps the SQL lint honest about interpolation.
    """

    for index, clause in enumerate(clauses):
        query += f"{' WHERE' if index == 0 else ' AND'} {clause}"
    return query


def _space_counts(conn: sqlite3.Connection, planning_space_id: str) -> dict:
    row = conn.execute(
        "SELECT COUNT(*) AS total,"
        " SUM(CASE WHEN s.is_terminal = 0 THEN 1 ELSE 0 END) AS open,"
        " SUM(CASE WHEN s.category = 'active' THEN 1 ELSE 0 END) AS active,"
        " SUM(CASE WHEN s.category = 'completed' THEN 1 ELSE 0 END) AS completed"
        " FROM work_items i JOIN workflow_states s ON s.state_id = i.state_id"
        " WHERE i.planning_space_id = ?",
        (planning_space_id,),
    ).fetchone()
    return {
        "total": int(row["total"] or 0),
        "open": int(row["open"] or 0),
        "active": int(row["active"] or 0),
        "completed": int(row["completed"] or 0),
    }


def _space_row(conn: sqlite3.Connection, reference: object) -> sqlite3.Row:
    text = model.text_field(reference, "planning space", limit=200)
    row = conn.execute(
        "SELECT * FROM planning_spaces WHERE planning_space_id = ? OR key = ? OR name = ?",
        (text, text, text),
    ).fetchone()
    if row is None:
        raise model.PlanningError(f"no planning space named {text}")
    return row


def _workflow_payload(conn: sqlite3.Connection, workflow: sqlite3.Row) -> dict:
    states = store.states_for_workflow(conn, str(workflow["workflow_id"]))
    return {
        "workflow_id": workflow["workflow_id"],
        "name": workflow["name"],
        "initial_state_id": workflow["initial_state_id"],
        "states": [
            {
                "state_id": state["state_id"],
                "key": state["key"],
                "name": state["name"],
                "category": state["category"],
                "position": int(state["position"]),
                "is_terminal": bool(state["is_terminal"]),
            }
            for state in states
        ],
        "transitions": [
            {"from": source, "to": target}
            for source, target in store.transitions_for_workflow(conn, str(workflow["workflow_id"]))
        ],
    }


def _state_row(conn: sqlite3.Connection, workflow_id: str, reference: object) -> sqlite3.Row:
    text = model.text_field(reference, "workflow state", limit=64)
    row = conn.execute(
        "SELECT * FROM workflow_states WHERE workflow_id = ? AND (state_id = ? OR key = ?)",
        (workflow_id, text, text),
    ).fetchone()
    if row is None:
        raise model.PlanningError(f"this workflow has no state named {text}")
    return row


def _require_revision(row: sqlite3.Row, expected: int | None) -> None:
    if expected is None:
        return
    if not isinstance(expected, int) or isinstance(expected, bool) or expected < 0:
        raise model.PlanningError("expected_revision must be a non-negative integer")
    actual = int(row["revision"])
    if actual != expected:
        raise model.RevisionConflictError(expected, actual)


def _write(
    conn: sqlite3.Connection, row: sqlite3.Row, updates: list[str], parameters: list[object]
) -> None:
    """Write what this row justified, or refuse because it no longer holds.

    Every verb above reads an item, decides from what it read, and writes once.
    The read takes no lock, so another connection can commit in between and the
    decision stops being true while it is being acted on: two agents both saw an
    unheld item, and both wrote their own name into it. Naming the revision in
    the WHERE clause is what makes the write mean "and nothing changed since I
    looked" — one UPDATE matches, the other matches nothing and is refused here
    instead of landing on top of a claim that already exists.

    The row is passed rather than the id for the same reason: a write cannot be
    issued without the read it came from.
    """

    query = "UPDATE work_items SET"
    for index, update in enumerate(updates):
        query += f"{'' if index == 0 else ','} {update}"
    query += ", revision = revision + 1, updated_at = " + _NOW
    query += " WHERE work_item_id = ? AND revision = ?"
    identity = str(row["work_item_id"])
    expected = int(row["revision"])
    if conn.execute(query, (*parameters, identity, expected)).rowcount == 1:
        return
    current = conn.execute(
        "SELECT revision FROM work_items WHERE work_item_id = ?", (identity,)
    ).fetchone()
    if current is None:
        raise model.PlanningError("that work item was deleted while this change was being made")
    raise model.RevisionConflictError(expected, int(current[0]))


def _log(
    conn: sqlite3.Connection,
    work_item_id: str,
    action: str,
    detail: str,
    author: str | None,
) -> None:
    conn.execute(
        "INSERT INTO work_item_events(work_item_id,action,detail,author) VALUES(?,?,?,?)",
        (
            work_item_id,
            model.event_action(action),
            model.text_field(detail, "event.detail", limit=512, required=False),
            model.actor(author),
        ),
    )


def _step(steps: list[dict], item_id: object, conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
    wanted = model.identifier(item_id, "checklist item id")
    for step in steps:
        if step["id"] == wanted:
            return step
    raise model.PlanningError(f"{read_model.reference(conn, row)} has no checklist step {wanted}")


def _tail_position(conn: sqlite3.Connection, planning_space_id: str, state_id: str) -> float:
    row = conn.execute(
        "SELECT MAX(position) FROM work_items WHERE planning_space_id = ? AND state_id = ?",
        (planning_space_id, state_id),
    ).fetchone()
    return float(row[0] or 0.0) + 1.0
