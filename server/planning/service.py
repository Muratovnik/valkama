"""Every Planning operation, and the only place that writes a work item.

A caller names an item by its UUID or by what a person types — `MAIN-142` — and
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

from . import calls, leases, model, ranking, read_model, states, store, transitions

_NOW = "strftime('%Y-%m-%dT%H:%M:%SZ','now')"

#: How many candidates the take-next queue will try before reporting the race it
#: keeps losing. Bounded rather than open-ended because a caller inside its own
#: older transaction would otherwise be offered the same item forever.
_READY_CLAIM_ATTEMPTS = 8

#: The most items one page of a list carries. A larger limit is answered with
#: this many and the offset of the next page, never with a silent cut.
MAX_LIST_PAGE = 1000

#: The same bound for one page of a search.
MAX_SEARCH_PAGE = 200


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


def get_work_item(
    conn: sqlite3.Connection,
    reference: str,
    *,
    comments: int | None = None,
    comments_after: int = 0,
    events: int | None = None,
    sessions: bool = False,
) -> dict:
    """One item in full; `comments` and `events` keep only the newest of each.

    `comments_after` keeps only the comments after that id. `sessions` adds the
    agent sessions whose confirmed calls wrote to it. Without any of these the
    answer is the complete record a screen draws from.
    """

    record = read_model.present(
        conn,
        read_model.item_row(conn, reference),
        full=True,
        comments=comments,
        comments_after=comments_after,
        events=events,
    )
    if sessions:
        record["sessions"] = read_model.sessions(conn, str(record["work_item_id"]))
    return record


def list_work_items(
    conn: sqlite3.Connection,
    *,
    space: str | None = None,
    state_key: str | None = None,
    category: str | None = None,
    kind: str | None = None,
    owner: str | None = None,
    parent: str | None = None,
    limit: int | None = 200,
    offset: int = 0,
) -> list[dict]:
    """Exactly `limit` items from `offset` on, or every one of them when limit is None.

    `parent` keeps only the children of that item, named as any item is named.

    Nothing here caps the count: a caller that wants a bounded page with an
    honest account of what it left out asks `list_work_items_page`.
    """

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
    if parent is not None:
        clauses.append("i.parent_id = ?")
        parameters.append(str(read_model.item_row(conn, parent)["work_item_id"]))
    query = with_clauses(
        "SELECT i.* FROM work_items i JOIN workflow_states s ON s.state_id = i.state_id", clauses
    )
    # The work item id closes the order: two spaces can tie on every other key,
    # and an order with ties lets one page repeat an item the next page skips.
    query += " ORDER BY s.position, i.position, i.number, i.work_item_id"
    query += " LIMIT ? OFFSET ?"
    parameters.extend(
        [-1 if limit is None else max(1, int(limit)), model.count_field(offset, "offset")]
    )
    rows = conn.execute(query, parameters).fetchall()
    closed = read_model.closings(conn, rows)
    return [read_model.present(conn, row, closed=closed) for row in rows]


def list_work_items_page(
    conn: sqlite3.Connection,
    *,
    space: str | None = None,
    state_key: str | None = None,
    category: str | None = None,
    kind: str | None = None,
    owner: str | None = None,
    parent: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> dict:
    """One page of `list_work_items`, saying whether more follow and from where."""

    size = max(1, min(int(limit), MAX_LIST_PAGE))
    found = list_work_items(
        conn,
        space=space,
        state_key=state_key,
        category=category,
        kind=kind,
        owner=owner,
        parent=parent,
        limit=size + 1,
        offset=offset,
    )
    return _page(found, size, offset)


def search_work_items(
    conn: sqlite3.Connection,
    query: str,
    *,
    space: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """Items whose text, labels, source, summary or comments carry the query.

    A comment counts: an item is often findable only by what somebody wrote
    under it, and a hit there is reported as the matching line rather than as a
    bare row, so the reader can see why the item came back. Like
    `list_work_items`, it returns exactly `limit` matches and caps nothing.

    A query that is exactly a reference puts that item first, and every other
    match keeps its order, newest change first. A query that is a number alone
    does the same for the item of that number, or across spaces for each
    space's item of it. The order is decided before the page is cut, so the
    item a person typed the number of never falls off the page behind the
    items that only mention it.
    """

    text = model.text_field(query, "query", limit=200)
    like = f"%{text}%"
    parameters: list[object] = [like, like]
    clauses = [
        "(i.title LIKE ? OR i.description LIKE ? OR i.labels LIKE ? OR i.source LIKE ?"
        " OR i.summary LIKE ?"
        " OR (p.key || '-' || CAST(i.number AS TEXT)) LIKE ?"
        " OR EXISTS (SELECT 1 FROM work_item_comments m"
        "  WHERE m.work_item_id = i.work_item_id AND (m.body LIKE ? OR m.report LIKE ?)))"
    ]
    parameters.extend([like] * 8)
    if space is not None:
        clauses.append("i.planning_space_id = ?")
        parameters.append(str(_space_row(conn, space)["planning_space_id"]))
    query = with_clauses(
        "SELECT i.*, ("
        "  SELECT CASE WHEN m.report != '' THEN m.report ELSE m.body END"
        "  FROM work_item_comments m"
        "  WHERE m.work_item_id = i.work_item_id AND (m.body LIKE ? OR m.report LIKE ?)"
        "  ORDER BY m.id DESC LIMIT 1"
        " ) AS comment_hit"
        " FROM work_items i JOIN workflow_states s ON s.state_id = i.state_id"
        " JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id",
        clauses,
    )
    order = "i.updated_at DESC, i.work_item_id"
    reference = model.exact_reference(text)
    number = model.exact_number(text)
    if reference is not None:
        key, number = model.parse_human_id(reference)
        order = "CASE WHEN p.key = ? AND i.number = ? THEN 0 ELSE 1 END, " + order
        parameters.extend([key, number])
    elif number is not None:
        order = "CASE WHEN i.number = ? THEN 0 ELSE 1 END, " + order
        parameters.append(number)
    query += " ORDER BY " + order + " LIMIT ? OFFSET ?"
    rows = conn.execute(
        query, (*parameters, max(1, int(limit)), model.count_field(offset, "offset"))
    ).fetchall()
    found = []
    for row in rows:
        item = read_model.present(conn, row)
        if row["comment_hit"]:
            item["comment_hit"] = str(row["comment_hit"])[:240]
        if text.lower() in str(row["summary"] or "").lower():
            item["summary_hit"] = True
        found.append(item)
    return found


def search_work_items_page(
    conn: sqlite3.Connection,
    query: str,
    *,
    space: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """One page of `search_work_items`, saying whether more follow and from where."""

    size = max(1, min(int(limit), MAX_SEARCH_PAGE))
    found = search_work_items(conn, query, space=space, limit=size + 1, offset=offset)
    return _page(found, size, offset)


def _page(found: list[dict], size: int, offset: int) -> dict:
    """A page read one item past its size, so a cut is known rather than guessed.

    `next_offset` is where the following page starts when this one was cut, and
    None when nothing follows: a caller pages until it is None.
    """

    truncated = len(found) > size
    return {
        "work_items": found[:size],
        "truncated": truncated,
        "next_offset": offset + size if truncated else None,
    }


# -- writing -----------------------------------------------------------------


def create_planning_space(
    conn: sqlite3.Connection, *, project_id: str, name: str, key: str | None = None
) -> dict:
    space = store.create_space(conn, project_id=project_id, name=name, key=key)
    return get_planning_space(conn, space["planning_space_id"])


def _parent_row(
    conn: sqlite3.Connection, space_id: str, parent: str | None, item_id: str | None = None
) -> sqlite3.Row | None:
    """The row a work item may take as its parent, or None when it takes none.

    Creating and reparenting answer to the same rules, so both call this. An
    `item_id` is given only when an existing item is reparented: a new item
    cannot yet name itself or have children.
    """

    if not parent:
        return None
    parent_row = read_model.item_row(conn, parent)
    if item_id is not None and str(parent_row["work_item_id"]) == item_id:
        raise model.PlanningError("a work item cannot be its own parent")
    if str(parent_row["planning_space_id"]) != space_id:
        raise model.PlanningError("a parent work item lives in another planning space")
    if parent_row["parent_id"]:
        raise model.PlanningError("a work item hierarchy is one level deep")
    if item_id is not None:
        children = conn.execute(
            "SELECT COUNT(*) FROM work_items WHERE parent_id = ?", (item_id,)
        ).fetchone()[0]
        if children:
            raise model.PlanningError(
                "a work item with children cannot become a child; the hierarchy is one level deep"
            )
    return parent_row


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
        states.resolve(conn, str(workflow["workflow_id"]), state)
        if state
        else read_model.state_by_id(conn, str(workflow["initial_state_id"]))
    )
    parent_row = _parent_row(conn, space_id, parent)
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
    rank: str | None = None,
    expected_revision: int | None = None,
    author: str | None = None,
) -> dict:
    """Edit the fields a transition does not own, and where the item stands in its state.

    `rank` is a placement in the item's own state (`ranking.placement`). It is an
    edit like the others: one guarded write, one revision, no history event.
    """

    row = read_model.item_row(conn, reference)
    _require_revision(row, expected_revision)
    placement = ranking.placement(rank) if rank is not None else None
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
        parent_row = _parent_row(
            conn, str(row["planning_space_id"]), parent, item_id=str(row["work_item_id"])
        )
        updates.append("parent_id = ?")
        parameters.append(str(parent_row["work_item_id"]) if parent_row is not None else None)
    if placement is not None:
        # Last, because it is the one step that may write before `_write` does:
        # every refusal above has had its chance to leave the store untouched.
        placed = ranking.position(
            conn, row, read_model.state_by_id(conn, str(row["state_id"])), placement
        )
        if placed is not None:
            updates.append("position = ?")
            parameters.append(placed)
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
    rank: str | None = None,
    expected_revision: int | None = None,
    author: str | None = None,
) -> dict:
    """Move an item to a state, last in that state unless `rank` places it.

    Last is where a build without placements puts a moved item too, so an item
    that enters a state queues behind the work already ordered there.

    A terminal state ends every claim on the item in the same write: a claim
    says somebody is working it, and nobody works a closed item. Closed items
    used to keep a live claim until a second call released it, or until the
    lease ran out a fortnight later, and read as held all that time. The
    holder is not lost: the `released` event names it, and the read model's
    `last_claim_ref` reads it back. A step claim ends too. A completed close
    never has one, since every step is ticked and a tick clears its claim; a
    cancelled or forced close can, and its open steps stay open, unheld.
    Reopening the item later restores nothing.
    """

    row = read_model.item_row(conn, reference)
    _require_revision(row, expected_revision)
    target = states.resolve(conn, str(row["workflow_id"]), state)
    placement = ranking.placement(rank) if rank is not None else None
    refusals, warnings = transitions.findings(conn, row, target, reason=reason)
    if refusals and not force:
        raise model.WorkflowGuardError(
            "; ".join(f"[{guard}] {message}" for guard, message in refusals)
        )
    position = (
        _tail_position(conn, str(row["planning_space_id"]), str(target["state_id"]))
        if placement is None
        else ranking.position(conn, row, target, placement)
    )
    if position is None:
        position = float(row["position"])
    updates = ["state_id = ?", "position = ?"]
    parameters: list[object] = [str(target["state_id"]), position]
    held = str(row["claim_ref"]) if target["is_terminal"] else ""
    steps = model.checklist(row["checklist"])
    unheld = [step for step in steps if target["is_terminal"] and step["claimed_by"]]
    if held:
        updates += ["claim_ref = ?", "claim_call_id = ?"]
        parameters += ["", None]
    if unheld:
        for step in unheld:
            step["claimed_by"] = ""
        updates.append("checklist = ?")
        parameters.append(model.dumps(steps))
    _write(conn, row, updates, parameters)
    detail = str(target["key"])
    if reason.strip():
        detail = f"{detail}: {model.text_field(reason, 'reason', limit=512)}"
    _log(conn, str(row["work_item_id"]), "transitioned", detail, author)
    if held:
        _log(conn, str(row["work_item_id"]), "released", held, author)
    for step in unheld:
        _log(conn, str(row["work_item_id"]), "checklist_released", step["text"][:120], author)
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
    if held:
        answer["released"] = held
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
    start_reason: str = "claimed",
    move_state: bool = True,
) -> dict:
    """Take, release or take over an item, deciding who holds it from its lease.

    A stale lease is released before anything else, so taking it over needs no
    `force` and the history shows the expiry and the claim as two events. The
    one exception is the holding session itself: it is still the holder, and
    its own call has just counted as its heartbeat.

    Taking an item that has not started starts it (`_start`), and
    `start_reason` is what that transition records. Releasing an item under way
    puts it back in the queue (`_hand_back`). `move_state=False` does neither,
    for a caller that sets the state itself: a launch putting back what it found.
    """

    row = read_model.item_row(conn, reference)
    _require_revision(row, expected_revision)
    # `actor` is what the caller signs; `label` what it holds as. An unconfirmed
    # lease is still compared by the signature, as every claim was before.
    actor = model.actor(author)
    label = calls.holder(author)
    caller = calls.current()
    lease = leases.lease(conn, row)
    expired = False
    if (
        lease is not None
        and lease.state == leases.STALE
        and not leases.held_by(lease, caller, actor)
    ):
        row = _expire(conn, row, lease)
        lease, expired = None, True
    held = lease.holder if lease is not None else ""
    holder = lease is not None and leases.held_by(lease, caller, actor)
    if release:
        if expired:
            # The lease this release named is already gone, released above.
            return read_model.present(conn, row, full=True)
        if lease is not None and not holder and not force:
            raise model.PlanningError(
                f"{read_model.reference(conn, row)} is held by {held}, not by you"
            )
        _hold(conn, row, "")
        _log(conn, str(row["work_item_id"]), "released", held, author)
    elif lease is not None and not holder:
        if not force:
            raise model.PlanningError(
                f"{read_model.reference(conn, row)} is already held by {held};"
                " pass force to take the work over"
            )
        _hold(conn, row, label)
        _log(conn, str(row["work_item_id"]), "taken_over", held, author)
    else:
        try:
            _hold(conn, row, label)
        except model.RevisionConflictError:
            return _claim_lost(conn, row, actor)
        _log(conn, str(row["work_item_id"]), "claimed", "", author)
    identity = str(row["work_item_id"])
    if not move_state:
        return read_model.present(conn, read_model.item_by_id(conn, identity), full=True)
    if release:
        requeued = _hand_back(conn, identity, author, "released")
        answer = read_model.present(conn, read_model.item_by_id(conn, identity), full=True)
        if requeued is not None:
            answer["requeued"] = requeued
        return answer
    return _start(conn, identity, author, start_reason)


def _start(conn: sqlite3.Connection, identity: str, author: str | None, reason: str) -> dict:
    """Move an item its claim just took into the active state, and answer with it.

    A claim is the moment work starts, and an item left in the backlog while an
    agent worked it told everyone reading the board that nobody had begun. So
    an item in a `backlog` or `queued` state moves to the first active state
    its workflow lets it reach, through the transition guards like any other
    move, and the answer's `started` names where it came from and went. An item
    under way, in review, blocked or finished stays where it is: review and
    blocked say something a claim does not undo, and reopening finished work is
    a decision of its own. A startable item with no active state to reach stays
    too, and `warnings` says so.
    """

    row = read_model.item_by_id(conn, identity)
    current = read_model.state_by_id(conn, str(row["state_id"]))
    if current["category"] not in states.STARTABLE:
        return read_model.present(conn, row, full=True)
    reference = read_model.reference(conn, row)
    target = states.start_state(conn, row)
    if target is None:
        answer = read_model.present(conn, row, full=True)
        answer["warnings"] = [
            f"{reference} stays in {current['name']}: its workflow has no active state"
            " it can move to"
        ]
        return answer
    refusals, warnings = transitions.findings(conn, row, target)
    if refusals:
        answer = read_model.present(conn, row, full=True)
        answer["warnings"] = [
            f"{reference} stays in {current['name']}: {message}" for _guard, message in refusals
        ]
        return answer
    position = _tail_position(conn, str(row["planning_space_id"]), str(target["state_id"]))
    _write(conn, row, ["state_id = ?", "position = ?"], [str(target["state_id"]), position])
    _log(conn, identity, "transitioned", f"{target['key']}: {reason}", author)
    answer = read_model.present(conn, read_model.item_by_id(conn, identity), full=True)
    answer["started"] = {"from": str(current["key"]), "to": str(target["key"])}
    if warnings:
        answer["warnings"] = warnings
    return answer


def _hand_back(
    conn: sqlite3.Connection, identity: str, author: str | None, reason: str
) -> dict | None:
    """Put an item nobody holds any more back where the take-next queue finds it.

    The other half of `_start`. A claim starts its item, so without this every
    released or expired claim would leave its item in an active state with no
    holder: not ready, because the queue takes only unstarted work, and not
    abandoned either, because that list is of held items. So an item in an
    active state goes back to the first queued state its workflow lets it reach,
    or the backlog when there is none; the answer is that move, for the
    caller's `requeued`, or None. Its checklist, comments and history stay. An
    item whose checklist still has a claimed step stays active, because that
    step's holder is still its executor; review, blocked and finished items stay
    where they are.
    """

    row = read_model.item_by_id(conn, identity)
    current = read_model.state_by_id(conn, str(row["state_id"]))
    if current["category"] != "active" or any(
        step["claimed_by"] for step in model.checklist(row["checklist"])
    ):
        return None
    target = states.queue_state(conn, row)
    if target is None:
        return None
    position = _tail_position(conn, str(row["planning_space_id"]), str(target["state_id"]))
    _write(conn, row, ["state_id = ?", "position = ?"], [str(target["state_id"]), position])
    _log(conn, identity, "transitioned", f"{target['key']}: {reason}", author)
    return {"from": str(current["key"]), "to": str(target["key"])}


def _claim_lost(conn: sqlite3.Connection, row: sqlite3.Row, actor: str) -> dict:
    """Answer a claim that lost its race the way a claim is supposed to fail.

    What a caller is promised is that a claim fails naming the holder, not that
    it reports a revision — so the answer to losing comes from re-reading who
    holds it now. Finding oneself there is the same outcome that was asked for,
    and saying so keeps a retry from being punished for the race it already won.
    """

    fresh = read_model.item_by_id(conn, str(row["work_item_id"]))
    lease = leases.lease(conn, fresh)
    if lease is not None and leases.held_by(lease, calls.current(), actor):
        return read_model.present(conn, fresh, full=True)
    if lease is not None:
        raise model.PlanningError(
            f"{read_model.reference(conn, fresh)} is already held by {lease.holder};"
            " pass force to take the work over"
        ) from None
    raise model.RevisionConflictError(int(row["revision"]), int(fresh["revision"])) from None


def expire_leases(conn: sqlite3.Connection, *, space_id: str | None = None) -> int:
    """Release every stale lease past its grace, in one space or all; how many were released.

    Only a lease a confirmed session holds can lapse: an unconfirmed claim has
    no session to go quiet. A lease in its grace waits for its session to come
    back, since nobody asked for that item in particular. A lease another writer
    changed in the meantime is left to it.
    """

    clauses = [
        "i.claim_ref != ''",
        "c.identity_state = 'confirmed'",
        "COALESCE(c.session_id, '') != ''",
    ]
    parameters: list[object] = []
    if space_id is not None:
        clauses.append("i.planning_space_id = ?")
        parameters.append(space_id)
    query = with_clauses(
        "SELECT i.* FROM work_items i JOIN execution_events c ON c.id = i.claim_call_id", clauses
    )
    expired = 0
    for row in conn.execute(query + " ORDER BY i.number", parameters).fetchall():
        lease = leases.lease(conn, row)
        if lease is None or lease.state != leases.STALE or lease.in_grace:
            continue
        try:
            _expire(conn, row, lease)
        except model.RevisionConflictError:
            continue
        expired += 1
    return expired


def _expire(conn: sqlite3.Connection, row: sqlite3.Row, lease: leases.Lease) -> sqlite3.Row:
    """Release a stale lease as a write of Valkama's own, and return the row after it.

    The release is its own call, so the history says who released it and why
    rather than charging the expiry to whichever caller happened to meet it. The
    why is the lease's own reason, in the release and in the move back to the queue.
    """

    identity = str(row["work_item_id"])
    with calls.bind(calls.valkama(), leases.EXPIRY_TOOL):
        _hold(conn, row, "")
        _log(conn, identity, "released", leases.expiry_detail(lease), leases.EXPIRY_AUTHOR)
        _hand_back(conn, identity, leases.EXPIRY_AUTHOR, lease.reason)
    return read_model.item_by_id(conn, identity)


def claim_ready_work_item(
    conn: sqlite3.Connection,
    *,
    space: str | None = None,
    author: str | None = None,
) -> dict | None:
    """Pick the next unheld, unblocked item in a startable state and take it.

    The next one is the first in the order of work: a queued state before the
    backlog, and inside a state the order the board shows, top first. Priority
    only breaks a tie in that order, so placing an item first is what puts it
    next, and an urgent item nobody placed waits its turn.

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
    space_id = str(_space_row(conn, space)["planning_space_id"]) if space is not None else None
    if space_id is not None:
        clauses.append("i.planning_space_id = ?")
        parameters.append(space_id)
    query = with_clauses(
        "SELECT i.* FROM work_items i JOIN workflow_states s ON s.state_id = i.state_id", clauses
    )
    query += " ORDER BY " + ranking.WORK_ORDER_SQL + ", s.position, i.position,"
    query += " CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1"
    query += " WHEN 'medium' THEN 2 ELSE 3 END, i.number LIMIT 1"
    label = calls.holder(author)
    # An expired lease is not a holder, so the queue sees through it: released
    # first, the item then reads unheld to the filter above. A lease in its grace
    # is still held, so the queue neither gives that item nor releases it.
    expire_leases(conn, space_id=space_id)
    lost: model.RevisionConflictError | None = None
    for _ in range(_READY_CLAIM_ATTEMPTS):
        row = conn.execute(query, tuple(parameters)).fetchone()
        if row is None:
            return None
        try:
            _hold(conn, row, label)
        except model.RevisionConflictError as conflict:
            lost = conflict
            continue
        _log(conn, str(row["work_item_id"]), "claimed", "", author)
        return _start(conn, str(row["work_item_id"]), author, "claimed")
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
    """Set the steps, keeping every step the new list repeats.

    A step is text, or `{text, done}`. One that repeats a step the item has —
    the same text, or that step's own `id` — is that step: it keeps its id and
    its claim, tick and author, so appending to a checklist is sending it with
    the new steps after the old. Only a claimed or completed step the new list
    leaves out needs `force`, because only dropping one discards its state.

    A step sent done that was not done is recorded as done by the caller, with
    the `checklist_completed` event a tick would write, so setting a step done
    and ticking it are one history; a step is reopened by a tick, not by
    leaving `done` out. A step that names an `id` the item does not have is one
    being carried over from elsewhere, and keeps the state it carries.
    """

    row = read_model.item_row(conn, reference)
    _require_revision(row, expected_revision)
    existing = model.checklist(row["checklist"])
    sent_steps = model.checklist(items)
    # The steps as sent, beside the steps as read; anything but a list (a stored
    # checklist's JSON text) carries nothing new.
    sent = items if isinstance(items, list) else [None] * len(sent_steps)
    by_id = {step["id"]: step for step in existing}
    label = calls.holder(author)
    kept: set[str] = set()
    replacement: list[dict] = []
    completed: list[dict] = []
    for step, raw in zip(sent_steps, sent, strict=True):
        named = raw.get("id") if isinstance(raw, dict) else None
        if named and named not in by_id:
            replacement.append(step)  # carried over, with the state it carries
            continue
        match = (
            by_id[named]
            if named
            else next(
                (old for old in existing if old["text"] == step["text"] and old["id"] not in kept),
                None,
            )
        )
        if match is None or match["id"] in kept:
            if step["done"] and not step["done_by"]:
                completed.append(step)
            replacement.append(step)
            continue
        kept.add(match["id"])
        same = {**match, "text": step["text"]}
        if step["done"] and not match["done"]:
            held = match["claimed_by"]
            # The tick's own guard: completing a step someone else holds is
            # theirs to do, whichever write sends it.
            if held and held not in (label, model.actor(author)) and not force:
                raise model.PlanningError(
                    f"that step is claimed by {held}; pass force to complete it anyway"
                )
            same.update(done=True, claimed_by="")
            completed.append(same)
        replacement.append(same)
    dropped = [
        step for step in existing if step["id"] not in kept and (step["done"] or step["claimed_by"])
    ]
    if dropped and not force:
        raise model.PlanningError(
            f"{read_model.reference(conn, row)} would lose {len(dropped)} claimed or completed"
            f" step(s): {'; '.join(step['text'][:80] for step in dropped)}. Send them again,"
            " by their text or id, to keep them, or pass force to discard that state"
            " explicitly"
        )
    for step in completed:
        step["done_by"] = label
    _write(conn, row, ["checklist = ?"], [model.dumps(replacement)])
    identity = str(row["work_item_id"])
    _log(conn, identity, "checklist_replaced", str(len(replacement)), author)
    for step in completed:
        _log(conn, identity, "checklist_completed", step["text"][:120], author)
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
    label = calls.holder(author)
    held = step["claimed_by"]
    # A step held under the caller's signature is the caller's too: that is how
    # every step was held before a session could hold one.
    mine = held in (label, model.actor(author))
    if release:
        if held and not mine and not force:
            raise model.PlanningError(f"that step is held by {held}, not by you")
        step["claimed_by"] = ""
        action = "checklist_released"
    elif held and not mine:
        if not force:
            raise model.PlanningError(
                f"that step is already held by {held}; pass force to take it over"
            )
        step["claimed_by"] = label
        action = "checklist_taken_over"
    else:
        step["claimed_by"] = label
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
    label = calls.holder(author)
    if step["claimed_by"] and step["claimed_by"] not in (label, model.actor(author)) and not force:
        raise model.PlanningError(
            f"that step is claimed by {step['claimed_by']}; pass force to complete it anyway"
        )
    step["done"] = bool(done)
    step["done_by"] = label if done else ""
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


#: The most items one merge folds into the item that survives it.
MAX_MERGE_ITEMS = 20


def merge_work_items(
    conn: sqlite3.Connection,
    reference: str,
    items: object,
    *,
    reason: str = "",
    force: bool = False,
    expected_revision: int | None = None,
    author: str | None = None,
) -> dict:
    """Fold items that turned out to be one change into the item that survives.

    A finding filed twice, or two items with one cause and one fix, are one
    change, and closing the extras as duplicates by hand lost what they held:
    the steps someone ticked, the discussion, the commits, the links that made
    other work wait. Here the survivor takes all of that — the steps with their
    ids, ticks and step claims, the discussion comments, the refs, and the links
    in their own direction — and each merged item is linked `duplicates` to it,
    given a summary naming it, released and closed in its cancelled state. What
    describes the merged item itself stays with it: its history, its reports,
    its description, its parent, a ref the survivor already has, and the links
    that would now tie the survivor to itself.

    Each write is one a single tool makes, with that tool's event, so a build
    that knows nothing of merging reads the result as links, checklists
    replaced, a comment, a summary and a transition. All of it happens or none
    of it does; what a caller can correct is refused before the first write.
    `force` carries through a claim another session holds and a guard that
    refuses the close, and each is recorded as `overridden`.
    """

    survivor = read_model.item_row(conn, reference)
    _require_revision(survivor, expected_revision)
    merged = _merged_rows(conn, survivor, items)
    overridden = _merge_claims(conn, [survivor, *merged], author, force)
    steps = model.checklist(survivor["checklist"])
    moving = [model.checklist(row["checklist"]) for row in merged]
    total = len(steps) + sum(len(found) for found in moving)
    if total > model.MAX_CHECKLIST:
        raise model.PlanningError(
            f"{read_model.reference(conn, survivor)} would hold {total} checklist steps;"
            f" a checklist holds at most {model.MAX_CHECKLIST}"
        )
    closing = []
    for row in merged:
        target = states.cancel_state(conn, row)
        if target is None:
            raise model.PlanningError(
                f"{read_model.reference(conn, row)} cannot close as a duplicate: its workflow"
                " has no cancelled state it can move to"
            )
        closing.append(target)
    note = model.text_field(reason, "reason", limit=512, required=False)
    if not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")
    conn.execute("SAVEPOINT planning_merge")
    try:
        answer = _fold(
            conn,
            survivor,
            steps,
            list(zip(merged, moving, closing, strict=True)),
            overridden=overridden,
            note=note,
            force=force,
            author=author,
        )
    except BaseException:
        conn.execute("ROLLBACK TO planning_merge")
        conn.execute("RELEASE planning_merge")
        raise
    conn.execute("RELEASE planning_merge")
    return answer


def _merged_rows(
    conn: sqlite3.Connection, survivor: sqlite3.Row, items: object
) -> list[sqlite3.Row]:
    """The items a merge folds in, each refused for what would make the merge untrue."""

    if not isinstance(items, list) or not 1 <= len(items) <= MAX_MERGE_ITEMS:
        raise model.PlanningError(f"items must list 1 to {MAX_MERGE_ITEMS} work items to merge")
    survivor_id = str(survivor["work_item_id"])
    survivor_ref = read_model.reference(conn, survivor)
    if read_model.state_by_id(conn, str(survivor["state_id"]))["is_terminal"]:
        raise model.PlanningError(
            f"{survivor_ref} is closed; reopen it before merging work into it"
        )
    rows: list[sqlite3.Row] = []
    seen = {survivor_id}
    for entry in items:
        row = read_model.item_row(conn, entry)
        identity = str(row["work_item_id"])
        found = read_model.reference(conn, row)
        if identity == survivor_id:
            raise model.PlanningError(f"{found} is the item the others merge into")
        if identity in seen:
            raise model.PlanningError(f"{found} is named twice")
        seen.add(identity)
        if str(row["planning_space_id"]) != str(survivor["planning_space_id"]):
            raise model.PlanningError(
                f"{found} lives in another planning space than {survivor_ref}"
            )
        state = read_model.state_by_id(conn, str(row["state_id"]))
        if state["is_terminal"]:
            raise model.PlanningError(
                f"{found} is already closed in {state['name']}; a closed item keeps its outcome"
            )
        children = conn.execute(
            "SELECT COUNT(*) FROM work_items WHERE parent_id = ?", (identity,)
        ).fetchone()[0]
        if children:
            raise model.PlanningError(
                f"{found} has {children} child item(s); give them another parent before merging it"
            )
        rows.append(row)
    return rows


def _merge_claims(
    conn: sqlite3.Connection, rows: list[sqlite3.Row], author: str | None, force: bool
) -> dict[str, str]:
    """The claims of other sessions a merge would override, by item id.

    Moving steps into an item someone else holds changes their work, and closing
    an item someone else holds ends it, so either needs `force`. A stale lease
    is nobody's work any more and does not stand in the way.
    """

    actor = model.actor(author)
    caller = calls.current()
    overridden: dict[str, str] = {}
    for row in rows:
        lease = leases.lease(conn, row)
        if lease is None or lease.state == leases.STALE or leases.held_by(lease, caller, actor):
            continue
        if not force:
            raise model.PlanningError(
                f"{read_model.reference(conn, row)} is held by {lease.holder};"
                " pass force to merge it anyway"
            )
        overridden[str(row["work_item_id"])] = lease.holder
    return overridden


def _fold(
    conn: sqlite3.Connection,
    survivor: sqlite3.Row,
    steps: list[dict],
    merging: list[tuple[sqlite3.Row, list[dict], sqlite3.Row]],
    *,
    overridden: dict[str, str],
    note: str,
    force: bool,
    author: str | None,
) -> dict:
    """The writes of a merge, in order, once every refusal has had its say."""

    survivor_id = str(survivor["work_item_id"])
    survivor_ref = read_model.reference(conn, survivor)
    # The first write of a call names what the call acted on: the survivor.
    calls.call_id(conn, survivor_id)
    involved = {survivor_id, *(str(row["work_item_id"]) for row, _steps, _target in merging)}
    carried = [step for _row, found, _target in merging for step in found]
    if carried:
        set_checklist(conn, survivor_id, [*steps, *carried], force=True, author=author)
    report: list[dict] = []
    warnings: list[str] = []
    forced: list[str] = []
    if survivor_id in overridden:
        _log(conn, survivor_id, "overridden", "claim", author)
        forced.append(f"{survivor_ref}: claim")
    for row, found, target in merging:
        identity = str(row["work_item_id"])
        reference = read_model.reference(conn, row)
        moved = {
            "steps": len(found),
            "comments": conn.execute(
                "UPDATE work_item_comments SET work_item_id = ? WHERE work_item_id = ?"
                " AND report = ''",
                (survivor_id, identity),
            ).rowcount,
            "refs": conn.execute(
                "UPDATE OR IGNORE work_item_refs SET work_item_id = ? WHERE work_item_id = ?",
                (survivor_id, identity),
            ).rowcount,
            "links": _repoint_links(conn, identity, survivor_id, involved, author),
        }
        if found:
            set_checklist(conn, identity, [], force=True, author=author)
        if not _linked(conn, identity, survivor_id, "duplicates"):
            link_work_items(conn, identity, survivor_id, "duplicates", author=author)
        current = read_model.item_by_id(conn, identity)
        if current["claim_ref"]:
            _hold(conn, current, "")
            _log(conn, identity, "released", str(current["claim_ref"]), author)
        if identity in overridden:
            _log(conn, identity, "overridden", "claim", author)
            forced.append(f"{reference}: claim")
        summary = {
            "done": f"Merged into {survivor_ref}, which now holds its {_counts(moved)}.",
            "next": f"Continue in {survivor_ref}.",
        }
        if note:
            summary["why"] = note
        set_summary(conn, identity, summary, author=author)
        closed = transition_work_item(
            conn,
            identity,
            str(target["state_id"]),
            reason=f"duplicate of {survivor_ref}",
            force=force,
            author=author,
        )
        warnings.extend(closed["warnings"])
        forced.extend(f"{reference}: {guard}" for guard in closed.get("overridden", []))
        parent = row["parent_id"]
        if parent and parent not in (survivor["parent_id"], survivor_id):
            warnings.append(
                f"{reference} stays under"
                f" {read_model.reference(conn, read_model.item_by_id(conn, str(parent)))};"
                f" {survivor_ref} keeps its own parent"
            )
        pending = conn.execute(
            "SELECT COUNT(*) FROM work_item_requests WHERE work_item_id = ? AND status = 'pending'",
            (identity,),
        ).fetchone()[0]
        if pending:
            warnings.append(f"{reference} has {pending} pending request(s); they close with it")
        report.append(
            {
                "reference": reference,
                "work_item_id": identity,
                "state": str(target["key"]),
                "moved": moved,
            }
        )
    totals = {name: sum(entry["moved"][name] for entry in report) for name in report[0]["moved"]}
    body = (
        f"Merged {', '.join(entry['reference'] for entry in report)} into this item:"
        f" {_counts(totals)} moved here."
    )
    comment_work_item(conn, survivor_id, f"{body} {note}" if note else body, author=author)
    answer = read_model.present(conn, read_model.item_by_id(conn, survivor_id), full=True)
    answer["merged"] = report
    if warnings:
        answer["warnings"] = warnings
    if forced:
        answer["overridden"] = forced
    return answer


def _repoint_links(
    conn: sqlite3.Connection,
    identity: str,
    survivor_id: str,
    involved: set[str],
    author: str | None,
) -> int:
    """Move one merged item's links to the survivor, each in its own direction.

    Removed and added through `link_work_items`, so the item at the other end
    records both. A link to the survivor or to another item of the same merge
    stays where it is: moved, it would tie the survivor to itself.
    """

    moved = 0
    links = conn.execute(
        "SELECT from_id, to_id, kind FROM work_item_links WHERE ? IN (from_id, to_id) ORDER BY id",
        (identity,),
    ).fetchall()
    for link in links:
        source, target, kind = str(link["from_id"]), str(link["to_id"]), str(link["kind"])
        if (target if source == identity else source) in involved:
            continue
        link_work_items(conn, source, target, kind, remove=True, author=author)
        source, target = (survivor_id, target) if source == identity else (source, survivor_id)
        if not _linked(conn, source, target, kind):
            link_work_items(conn, source, target, kind, author=author)
        moved += 1
    return moved


def _linked(conn: sqlite3.Connection, source: str, target: str, kind: str) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM work_item_links WHERE from_id = ? AND to_id = ? AND kind = ?",
            (source, target, kind),
        ).fetchone()
        is not None
    )


def _counts(moved: dict[str, int]) -> str:
    """`2 steps, 1 comment, 0 refs and 3 links`."""

    parts = [f"{count} {name if count != 1 else name[:-1]}" for name, count in moved.items()]
    return f"{', '.join(parts[:-1])} and {parts[-1]}"


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
        "INSERT OR IGNORE INTO work_item_refs(work_item_id,kind,value,label,author,call_id)"
        " VALUES(?,?,?,?,?,?)",
        (
            str(row["work_item_id"]),
            model.ref_kind(kind),
            model.text_field(value, "work_item_ref.value", limit=512),
            model.text_field(label, "work_item_ref.label", limit=200, required=False),
            model.actor(author),
            calls.call_id(conn, str(row["work_item_id"])),
        ),
    )
    return {
        "work_item": read_model.reference(conn, row),
        "kind": model.ref_kind(kind),
        "value": value,
    }


def comment_work_item(
    conn: sqlite3.Connection,
    reference: str,
    body: str,
    *,
    author: str | None = None,
    checklist_item_id: str | None = None,
) -> dict:
    if not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")
    row = read_model.item_row(conn, reference)
    step = (
        _step(model.checklist(row["checklist"]), checklist_item_id, conn, row)
        if checklist_item_id is not None
        else None
    )
    inserted = conn.execute(
        "INSERT INTO work_item_comments(work_item_id,author,body,checklist_item_id,"
        "checklist_item_text,call_id) VALUES(?,?,?,?,?,?)",
        (
            str(row["work_item_id"]),
            model.actor(author),
            model.multiline_field(body, "comment.body", limit=8000),
            step["id"] if step else None,
            step["text"] if step else None,
            calls.call_id(conn, str(row["work_item_id"])),
        ),
    )
    return {
        "work_item": read_model.reference(conn, row),
        "comment_count": read_model.comment_count(conn, row),
        "comment_id": inserted.lastrowid,
    }


def set_summary(
    conn: sqlite3.Connection,
    reference: str,
    payload: object,
    *,
    expected_revision: int | None = None,
    author: str | None = None,
) -> dict:
    return report_work_item(
        conn,
        reference,
        payload,
        make_current=True,
        expected_revision=expected_revision,
        author=author,
        require_revision=False,
    )


def report_work_item(
    conn: sqlite3.Connection,
    reference: str,
    payload: object,
    *,
    make_current: bool = False,
    expected_revision: int | None = None,
    author: str | None = None,
    require_revision: bool = True,
) -> dict:
    row = read_model.item_row(conn, reference)
    if make_current and require_revision and expected_revision is None:
        raise model.PlanningError("expected_revision is required when making a report current")
    _require_revision(row, expected_revision)
    record = model.summary(payload)
    identity = str(row["work_item_id"])
    # Keep the report and the guarded current-outcome write indivisible even
    # when a caller catches a refusal and commits its surrounding transaction.
    if not conn.in_transaction:
        conn.execute("BEGIN")
    conn.execute("SAVEPOINT planning_report")
    try:
        inserted = conn.execute(
            "INSERT INTO work_item_comments(work_item_id,author,body,report,call_id)"
            " VALUES(?,?,?,?,?)",
            (identity, model.actor(author), "", model.dumps(record), calls.call_id(conn, identity)),
        )
        updates = ["summary = ?", "summary_comment_id = ?"] if make_current else []
        parameters: list[object] = [model.dumps(record), inserted.lastrowid] if make_current else []
        _write(conn, row, updates, parameters)
        if make_current:
            _log(conn, identity, "summarized", "", author)
    except BaseException:
        conn.execute("ROLLBACK TO planning_report")
        conn.execute("RELEASE planning_report")
        raise
    conn.execute("RELEASE planning_report")
    return read_model.present(conn, read_model.item_by_id(conn, identity), full=True)


def select_summary(
    conn: sqlite3.Connection,
    reference: str,
    comment_id: int,
    *,
    expected_revision: int | None = None,
    author: str | None = None,
) -> dict:
    row = read_model.item_row(conn, reference)
    if expected_revision is None:
        raise model.PlanningError("expected_revision is required when selecting a report")
    _require_revision(row, expected_revision)
    if not isinstance(comment_id, int) or isinstance(comment_id, bool) or comment_id < 1:
        raise model.PlanningError("comment_id must be a positive integer")
    report = conn.execute(
        "SELECT report FROM work_item_comments WHERE id=? AND work_item_id=? AND report != ''",
        (comment_id, row["work_item_id"]),
    ).fetchone()
    if report is None:
        raise model.PlanningError("that comment is not a report belonging to this work item")
    if not conn.in_transaction:
        conn.execute("BEGIN")
    conn.execute("SAVEPOINT planning_summary")
    try:
        _write(conn, row, ["summary = ?", "summary_comment_id = ?"], [report["report"], comment_id])
        _log(conn, str(row["work_item_id"]), "summarized", "", author)
    except BaseException:
        conn.execute("ROLLBACK TO planning_summary")
        conn.execute("RELEASE planning_summary")
        raise
    conn.execute("RELEASE planning_summary")
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
    rows = store.states_for_workflow(conn, str(workflow["workflow_id"]))
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
            for state in rows
        ],
        "transitions": [
            {"from": source, "to": target}
            for source, target in store.transitions_for_workflow(conn, str(workflow["workflow_id"]))
        ],
    }


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
    query += (", " if updates else " ") + "revision = revision + 1, updated_at = " + _NOW
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


def _hold(conn: sqlite3.Connection, row: sqlite3.Row, holder: str) -> None:
    """Set who holds an item, and the call that took it, in one guarded write.

    The only writer of `claim_ref` but one: a transition into a terminal state
    clears both columns in its own write. The holder and the call travel together, so
    a lease always names the call that took it; a release clears both. A build
    that writes `claim_ref` alone leaves the call unchanged, and the store's
    `work_items_claim_follows_call` trigger clears it, which makes that claim
    read as unconfirmed rather than as somebody else's lease.
    """

    taken = calls.call_id(conn, str(row["work_item_id"])) if holder else None
    _write(conn, row, ["claim_ref = ?", "claim_call_id = ?"], [holder, taken])


def _log(
    conn: sqlite3.Connection,
    work_item_id: str,
    action: str,
    detail: str,
    author: str | None,
) -> None:
    conn.execute(
        "INSERT INTO work_item_events(work_item_id,action,detail,author,call_id) VALUES(?,?,?,?,?)",
        (
            work_item_id,
            model.event_action(action),
            model.text_field(detail, "event.detail", limit=512, required=False),
            model.actor(author),
            calls.call_id(conn, work_item_id),
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
