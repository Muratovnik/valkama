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

import contextlib
import contextvars
import dataclasses
import json
import sqlite3
from collections.abc import Iterator, Mapping, Sequence

from . import agents as planning_agents
from . import (
    calls,
    images,
    item_projects,
    item_tree,
    leases,
    model,
    questions,
    queue,
    read_model,
    request_model,
    states,
    store,
    subscriptions,
    transitions,
    waiting,
    words,
)
from . import participants as working

_NOW = "strftime('%Y-%m-%dT%H:%M:%SZ','now')"
#: How many questions to the owner are still pending on one item.
_OWNER_QUESTIONS_ON = (
    "SELECT COUNT(*) FROM work_item_requests r WHERE r.work_item_id = ? AND "  # noqa: S608 - constant text
    + questions.OWNER_QUESTION
)

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


#: The columns a space is read by, named: a store another build wrote answers a
#: missing one with `StoreSchemaError` rather than with a record lacking a field.
_SPACE_COLUMNS = "planning_space_id, name, key, provider_kind, launch_place, updated_at"


def _space_record(row: sqlite3.Row) -> dict:
    """A space as the store knows it. Its projects are the registry's, which
    `item_projects.with_projects` adds where a space is shown."""

    return {
        "planning_space_id": row["planning_space_id"],
        "name": row["name"],
        "key": row["key"],
        "provider_kind": row["provider_kind"],
        "launch_place": row["launch_place"],
    }


@read_model.whole_store_read()
def list_planning_spaces(conn: sqlite3.Connection) -> list[dict]:
    spaces = []
    for row in conn.execute(
        f"SELECT {_SPACE_COLUMNS} FROM planning_spaces ORDER BY name"  # noqa: S608
    ):
        counts = _space_counts(conn, str(row["planning_space_id"]))
        spaces.append(
            {
                **_space_record(row),
                "work_items": counts["total"],
                "open": counts["open"],
                "active": counts["active"],
                "completed": counts["completed"],
                "updated_at": row["updated_at"],
            }
        )
    return spaces


@read_model.whole_store_read()
def get_planning_space(conn: sqlite3.Connection, reference: str) -> dict:
    """One space, by id, key or name — whichever the caller has."""

    identity = space_identity(conn, reference)
    row = conn.execute(
        f"SELECT {_SPACE_COLUMNS} FROM planning_spaces WHERE planning_space_id = ?",  # noqa: S608
        (identity,),
    ).fetchone()
    workflow = store.workflow_for_space(conn, identity)
    return {**_space_record(row), "workflow": _workflow_payload(conn, workflow)}


@read_model.whole_store_read()
def get_work_item(
    conn: sqlite3.Connection,
    reference: str,
    *,
    comments: int | None = None,
    comments_after: int = 0,
    threads: int | None = None,
    thread: int | None = None,
    unresolved: bool = False,
    events: int | None = None,
    sessions: bool = False,
    agents: bool = False,
    participants: bool = False,
) -> dict:
    """One item in full; `comments` and `events` keep only the newest of each.

    `comments_after` keeps only the comments after that id. `threads` keeps the
    threads with the newest activity, `thread` one thread whole and `unresolved`
    a page of the roots without the resolved mark, as `read_model.present` says.
    `sessions` adds the agent sessions whose confirmed calls wrote to it, and
    `agents` the agents standing on it and an `executor` at the claim, each step
    and each agent, which only the card asks for. `participants` adds, to a goal
    or a stage, the sessions working on it (`planning.participants`), which costs a
    walk of the tree under it and so no write's answer carries. Without any of these
    the answer is the complete record a screen draws from. Every form carries
    `mentions`, the newest `read_model.HTTP_MENTIONS` comments on other items that
    named this one, oldest first, and `mentions_total`.
    """

    row = read_model.item_row(conn, reference)
    record = read_model.present(
        conn,
        row,
        full=True,
        comments=comments,
        comments_after=comments_after,
        threads=threads,
        thread=thread,
        unresolved=unresolved,
        events=events,
    )
    if sessions:
        record["sessions"] = read_model.sessions(conn, str(record["work_item_id"]))
    if agents:
        planning_agents.on_card(conn, record)
    if participants and row["kind"] == model.CONTAINER_KIND:
        record["participants"] = working.of_container(conn, row)
    return record


def get_work_item_brief(conn: sqlite3.Connection, reference: str) -> dict:
    """One item as a space's list carries it: no history, no agents.

    What a glance at an item needs — its state, title, holder, steps and dates —
    costs the same however long its discussion is, which the full record cannot.
    """

    return read_model.present(conn, read_model.item_row(conn, reference))


def list_work_items(
    conn: sqlite3.Connection,
    *,
    space: str | None = None,
    state: str | None = None,
    category: str | None = None,
    kind: str | None = None,
    owner: str | None = None,
    parent: str | None = None,
    project: str | None = None,
    other_spaces: bool = False,
    limit: int | None = 200,
    offset: int = 0,
) -> list[dict]:
    """Exactly `limit` items from `offset` on, or every one of them when limit is None.

    `parent` keeps only the children of that item, named as any item is named.
    `project` keeps the items that name that project (`item_projects.naming`: a goal
    or stage names what a task under it names), in every space unless `space` is
    given; a project no item names lists none.

    `other_spaces` makes `space` a read of that space: its items, and the items of
    other spaces that name one of the projects the registry binds to it, each record
    marked with `other_space`, the `{key, name}` of the space it lies in, or None
    for the space's own. The space's queue never gives another space's item, so
    its `withheld` adds `outside_space` and its `queue_order` is null, though its
    own space's queue may give it. With `project` too, another space's item is kept only when
    that project is one of the space's. Without it `space` keeps the space's items
    alone, which is what a reader that accounts for a space's items, an export,
    asks for.

    `kind` is named as a caller names it: `goal` keeps the containers under no
    parent and `stage` those under one. The service state is no state and no
    category a caller names: `container` is refused for either with the word that
    replaces it, as is every retired word (`kind=epic`, `category=backlog`), and a
    `state` name no workflow of the spaces read gives (by key, state id or a category
    one state has) is refused with their states.

    The items come in the one total order (`queue.list_key`), and each says its
    `queue_order`, its place in its own space's queue, or null when the queue
    does not give it. Every row the filters keep is loaded, ordered and then cut,
    so on a store nothing writes to the pages of one walk neither repeat nor skip.

    Nothing here caps the count: a caller that wants a bounded page with an
    honest account of what it left out asks `list_work_items_page`.
    """

    clauses: list[str] = []
    parameters: list[object] = []
    space_row = _space_row(conn, space) if space is not None else None
    space_id = str(space_row["planning_space_id"]) if space_row is not None else None
    wanted = item_projects.project_id(project, "project") if project is not None else None
    kept = item_projects.naming(conn, [wanted]) if wanted is not None else None
    marked = space_row is not None and other_spaces
    if space_row is not None:
        foreign = (
            item_projects.space_project_ids(conn, str(space_row["key"])) if other_spaces else []
        )
        if kept is not None:
            # Narrowed to one project, other spaces bring what names it, if it is the space's.
            foreign = [found for found in foreign if found == wanted]
        if foreign:
            clauses.append(
                "(i.planning_space_id = ? OR i.work_item_id IN (SELECT value FROM json_each(?)))"
            )
            reached = kept if kept is not None else item_projects.naming(conn, foreign)
            parameters.extend([space_id, json.dumps(reached)])
        else:
            clauses.append("i.planning_space_id = ?")
            parameters.append(space_id)
    if state is not None:
        workflows = (
            [str(store.workflow_for_space(conn, space_id)["workflow_id"])]
            if space_id is not None
            else [str(row[0]) for row in conn.execute("SELECT workflow_id FROM workflows")]
        )
        ids = states.filter_ids(conn, workflows, state)
        placeholders = ",".join("?" * len(ids))
        clauses.append(f"i.state_id IN ({placeholders})" if ids else "1 = 0")
        parameters.extend(ids)
    if category is not None:
        clauses.append("s.category = ?")
        parameters.append(model.state_category(category))
    if kind is not None:
        named = model.public_kind(kind)
        clauses.append("i.kind = ?")
        parameters.append(model.work_item_kind(named))
        if named == "goal":
            clauses.append("i.parent_id IS NULL")
        elif named == "stage":
            clauses.append("i.parent_id IS NOT NULL")
    if owner is not None:
        clauses.append("i.claim_ref = ?")
        parameters.append(model.actor(owner, "owner"))
    if parent is not None:
        clauses.append("i.parent_id = ?")
        parameters.append(str(read_model.item_row(conn, parent)["work_item_id"]))
    if kept is not None:
        clauses.append("i.work_item_id IN (SELECT value FROM json_each(?))")
        parameters.append(json.dumps(kept))
    start = model.count_field(offset, "offset")
    query = with_clauses(
        "SELECT i.*, s.position AS state_position, p.key AS space_key, p.name AS space_name"
        " FROM work_items i"
        " JOIN workflow_states s ON s.state_id = i.state_id"
        " JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id",
        clauses,
    )
    # Every row the filters keep, ordered and cut here rather than in SQL: the order
    # of work reads the tree, which the read loads anyway, once for the spaces read.
    rows = conn.execute(query, parameters).fetchall()
    spaces = {str(row["planning_space_id"]) for row in rows}
    tree = item_tree.of_spaces(conn, spaces)
    rows.sort(key=lambda row: queue.list_key(row, tree))
    rows = rows[start:] if limit is None else rows[start : start + max(1, int(limit))]
    # A row's place in its space's queue: one count of the queue of each space read.
    places = queue.places(
        queue.of_spaces(conn, {str(row["planning_space_id"]) for row in rows}, tree)
    )
    closed = read_model.closings(conn, rows)
    lapsed = read_model.lapsed_claims(conn, rows)
    projects = item_projects.of_items(conn, rows)
    # A read of one space asks another space's item of that space's queue, which
    # never gives it: its record says `outside_space`, and it has no place there.
    read_space = space_id if marked else None
    found = []
    for row in rows:
        record = read_model.present(
            conn,
            row,
            closed=closed,
            lapsed=lapsed,
            tree=tree,
            projects=projects,
            read_space=read_space,
        )
        outside = marked and str(row["planning_space_id"]) != space_id
        record["queue_order"] = None if outside else places.get(str(row["work_item_id"]))
        if marked:
            record["other_space"] = (
                {"key": row["space_key"], "name": row["space_name"]} if outside else None
            )
        found.append(record)
    return found


def _page_tree(conn: sqlite3.Connection, rows: Sequence[sqlite3.Row]) -> item_tree.Tree:
    """What every container of a page derives, read for the spaces it touches in one pass."""

    return item_tree.of_spaces(conn, {str(row["planning_space_id"]) for row in rows})


def list_work_items_page(
    conn: sqlite3.Connection,
    *,
    space: str | None = None,
    state: str | None = None,
    category: str | None = None,
    kind: str | None = None,
    owner: str | None = None,
    parent: str | None = None,
    project: str | None = None,
    other_spaces: bool = False,
    limit: int = 200,
    offset: int = 0,
) -> dict:
    """One page of `list_work_items`, saying whether more follow and from where."""

    size = max(1, min(int(limit), MAX_LIST_PAGE))
    found = list_work_items(
        conn,
        space=space,
        state=state,
        category=category,
        kind=kind,
        owner=owner,
        parent=parent,
        project=project,
        other_spaces=other_spaces,
        limit=size + 1,
        offset=offset,
    )
    return _page(found, size, offset)


#: The items whose questions carry a phrase, each with the newest such prompt last.
#: A search reads the prompt, the words of the fields and options, and what came back,
#: through the JSON rather than across it, so the names of the stored keys match
#: nothing and text that is not ASCII is read as written. Malformed JSON reads as
#: empty: a search is no place to refuse a stored row.
_QUESTION_HITS = (
    "SELECT q.work_item_id, q.prompt FROM work_item_requests q"
    " WHERE q.prompt LIKE ?"
    " OR EXISTS (SELECT 1 FROM json_tree("
    "CASE WHEN json_valid(q.fields_json) THEN q.fields_json END) f"
    " WHERE f.key IN ('label','description','why') AND f.atom LIKE ?)"
    " OR EXISTS (SELECT 1 FROM json_tree("
    "CASE WHEN json_valid(q.answers_json) THEN q.answers_json END) a"
    " WHERE a.type = 'text' AND a.atom LIKE ?)"
    " ORDER BY q.created_at"
)


def _question_hits(conn: sqlite3.Connection, like: str) -> dict[str, str]:
    """Which items a phrase finds through their questions, and the prompt that says why.

    An attached store is read as it is, and an old one has no requests to ask.
    """

    if (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='work_item_requests'"
        ).fetchone()
        is None
    ):
        return {}
    return {str(row[0]): str(row[1]) for row in conn.execute(_QUESTION_HITS, (like, like, like))}


def _decision_hits(conn: sqlite3.Connection, like: str) -> dict[str, str]:
    """Which items a phrase finds through a resolved mark's decision, and the newest such.

    Its own statement for the reason `_question_hits` is: an attached store is
    read as it is, and one older than threads has no such column to ask.
    """

    if (
        conn.execute(
            "SELECT 1 FROM pragma_table_info('work_item_comments') WHERE name='resolution'"
        ).fetchone()
        is None
    ):
        return {}
    return {
        str(row[0]): str(row[1])
        for row in conn.execute(
            "SELECT work_item_id, resolution FROM work_item_comments"
            " WHERE resolution LIKE ? ORDER BY id",
            (like,),
        )
    }


def search_work_items(
    conn: sqlite3.Connection,
    query: str,
    *,
    space: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """Items whose text, labels, source, projects, summary, comments or questions carry the query.

    A comment counts: an item is often findable only by what somebody wrote
    under it, and a hit there is reported as the matching line rather than as a
    bare row, so the reader can see why the item came back. Like
    `list_work_items`, it returns exactly `limit` matches and caps nothing.

    The query is read as words (`words`): an item matches when it holds every
    word, each cut to its first five letters and matched as a prefix, wherever
    the words stand, and the best match comes first, the title weighing three
    times the rest. Read as one phrase, a query of several words mostly found
    nothing.

    A query that is exactly a reference or a number alone is still read as a
    phrase, as before: a reference puts that item first, and every other match
    keeps its order, newest change first. A number alone does the same for the
    item of that number, or across spaces for each space's item of it. The
    order is decided before the page is cut, so the item a person typed the
    number of never falls off the page behind the items that only mention it.
    Where the index cannot be read -- a SQLite without FTS5, or an attached store
    an earlier build wrote -- every query is read as a phrase.
    """

    text = model.text_field(query, "query", limit=200)
    space_id = str(_space_row(conn, space)["planning_space_id"]) if space is not None else None
    found = words.stems(text)
    if found and model.exact_reference(text) is None and model.exact_number(text) is None:
        rows = words.search_rows(
            conn,
            found,
            space_id=space_id,
            limit=max(1, int(limit)),
            offset=model.count_field(offset, "offset"),
        )
        if rows is not None:
            tree = _page_tree(conn, rows)
            projects = item_projects.of_items(conn, rows)
            return [_word_hit(conn, row, found, tree, projects) for row in rows]
    return _phrase_search(conn, text, space_id=space_id, limit=limit, offset=offset)


def _word_hit(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    found: list[str],
    tree: item_tree.Tree,
    projects: Mapping[str, list[dict]],
) -> dict:
    """One item a word search found, with the lines that say why (`words.hits`)."""

    return {
        **read_model.present(conn, row, tree=tree, projects=projects),
        **words.hits(conn, row, found),
    }


def _phrase_search(
    conn: sqlite3.Connection,
    text: str,
    *,
    space_id: str | None,
    limit: int,
    offset: int,
) -> list[dict]:
    """The search before the word index: the whole query as one substring."""

    like = f"%{text}%"
    questions = _question_hits(conn, like)
    decisions = _decision_hits(conn, like)
    projects_found = item_projects.naming_like(conn, like)
    parameters: list[object] = [like, like]
    clauses = [
        "(i.title LIKE ? OR i.description LIKE ? OR i.labels LIKE ? OR i.source LIKE ?"
        " OR i.summary LIKE ?"
        " OR (p.key || '-' || CAST(i.number AS TEXT)) LIKE ?"
        " OR EXISTS (SELECT 1 FROM work_item_comments m"
        "  WHERE m.work_item_id = i.work_item_id AND (m.body LIKE ? OR m.report LIKE ?))"
        " OR i.work_item_id IN (SELECT value FROM json_each(?)))"
    ]
    parameters.extend([like] * 8)
    parameters.append(json.dumps([*questions, *decisions, *projects_found]))
    if space_id is not None:
        clauses.append("i.planning_space_id = ?")
        parameters.append(space_id)
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
    tree = _page_tree(conn, rows)
    projects = item_projects.of_items(conn, rows)
    for row in rows:
        item = read_model.present(conn, row, tree=tree, projects=projects)
        comment_hit = row["comment_hit"] or decisions.get(str(row["work_item_id"]))
        if comment_hit:
            item["comment_hit"] = str(comment_hit)[:240]
        question = questions.get(str(row["work_item_id"]))
        if question:
            item["question_hit"] = question[:240]
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


def create_planning_space(conn: sqlite3.Connection, *, name: str, key: str | None = None) -> dict:
    space = store.create_space(conn, name=name, key=key)
    return get_planning_space(conn, space["planning_space_id"])


def set_launch_place(conn: sqlite3.Connection, space: str, launch_place: object) -> dict:
    """Choose where a launch from this space's items runs (`item_projects.launch_root`).

    The owner's setting, not an agent's: no planning tool writes it.
    """

    if launch_place not in model.LAUNCH_PLACES:
        raise model.PlanningError("launch_place must be " + " or ".join(model.LAUNCH_PLACES))
    if not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")
    identity = space_identity(conn, space)
    conn.execute(
        "UPDATE planning_spaces SET launch_place = ?,"
        " updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')"
        " WHERE planning_space_id = ? AND launch_place != ?",
        (launch_place, identity, launch_place),
    )
    return get_planning_space(conn, identity)


def _parent_row(
    conn: sqlite3.Connection, space_id: str, parent: str | None, item_id: str | None = None
) -> sqlite3.Row | None:
    """The row a work item may take as its parent, or None when it takes none.

    Creating and reparenting answer to the same rules, so both call this. The
    parent exists, lives in the same space, is a goal or stage, is open, and is
    neither the item nor anything under it. The last is read by climbing from the
    parent to its root (`item_tree.above`), inside the write lock the caller took,
    so two crossing moves cannot both pass it. An `item_id` is given only when an
    existing item is reparented: a new item cannot yet name itself or have children.
    The tree has no depth limit.
    """

    if not parent:
        return None
    parent_row = read_model.item_row(conn, parent)
    if str(parent_row["planning_space_id"]) != space_id:
        raise model.PlanningError("a parent work item lives in another planning space")
    if parent_row["kind"] != model.CONTAINER_KIND:
        raise model.PlanningError("a task holds no children; convert it to a stage first")
    # Work filed under finished work would read as done before it began.
    if read_model.state_by_id(conn, str(parent_row["state_id"]))["is_terminal"]:
        raise model.PlanningError(
            f"{read_model.reference(conn, parent_row)} is closed; reopen it first"
        )
    if item_id is not None and any(
        identity == item_id
        for identity, _kind, _category in item_tree.above(conn, str(parent_row["work_item_id"]))
    ):
        raise model.PlanningError(
            f"{read_model.reference(conn, parent_row)} stands under this item, or is it:"
            " a parent there would close a cycle"
        )
    return parent_row


def create_work_item(
    conn: sqlite3.Connection,
    *,
    space: str | None = None,
    title: str,
    state: str | None = None,
    kind: str = "task",
    priority: str = "medium",
    description: str = "",
    labels: object = None,
    source: str = "",
    parent: str | None = None,
    author: str | None = None,
    acceptance: object = None,
    projects: object = None,
) -> dict:
    """A new item, placed where the work model puts it, accepted when it is accepted work.

    Without `state`, work filed inside a chain of accepted goals and stages is
    accepted with it, `inherited`, and so is work the owner files, as the owner's;
    an agent's stays in triage unless it names `acceptance`. Accepted work stands
    in ready, and a goal or stage accepted at once stands in the service state:
    `created` names no state for it, and `accepted` and `opened` follow. A named
    state is held to the refusals a move there meets (`transitions.placement`),
    and review, blocked and the closed states are refused (`new_item`): the move
    there carries what entering asks for.
    `projects` names the projects a task changes, each `named`
    (`item_projects`); a goal or stage names none. `space` may be left out: the
    item then lies where `item_projects.placement` puts it.
    """

    named_kind = model.public_kind(kind)
    stored_kind = model.work_item_kind(named_kind)
    if named_kind == "stage" and not parent:
        raise model.PlanningError("a stage is a container under a parent; without one it is a goal")
    changes = item_projects.named(projects) or []
    item_projects.require_nameable(changes, container=stored_kind == model.CONTAINER_KIND)
    space_row = _placed_space(conn, space, changes, parent)
    space_id = str(space_row["planning_space_id"])
    workflow = store.workflow_for_space(conn, space_id)
    workflow_id = str(workflow["workflow_id"])
    named = model.named_basis(acceptance)
    parent_row = _parent_row(conn, space_id, parent)
    parent_id = None if parent_row is None else str(parent_row["work_item_id"])
    entry = _entry_basis(named)
    given = _given(conn, parent_id, entry)
    if state:
        target = states.resolve(conn, workflow_id, state)
    elif given is not None:
        target = states.first_state(conn, workflow_id, "ready") or read_model.state_by_id(
            conn, str(workflow["initial_state_id"])
        )
    else:
        target = read_model.state_by_id(conn, str(workflow["initial_state_id"]))
    item = {"kind": stored_kind, "workflow_id": workflow_id}
    target = _destination(conn, item, target)
    basis = given if target["category"] in model.ACCEPTED_CATEGORIES else None
    refusals = transitions.placement(item, None, target, reference="the new item", basis=basis)
    if target["category"] == "active":
        refusals.append(
            ("executor", "the new item has no executor: create it with claim to start it at once")
        )
    transitions.refuse(refusals, False)
    item_id = model.new_id()
    number = store.next_number(conn, space_id)
    starts = stored_kind != model.CONTAINER_KIND and target["category"] in model.STARTING_CATEGORIES
    conn.execute(
        "INSERT INTO work_items(work_item_id,planning_space_id,number,workflow_id,state_id,kind,"
        "parent_id,priority,title,description,labels,source,acceptance,accepted_at,"
        "started_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,"
        f" CASE WHEN ? IS NULL THEN NULL ELSE {_NOW} END, CASE WHEN ? THEN {_NOW} END)",
        (
            item_id,
            space_id,
            number,
            workflow_id,
            str(target["state_id"]),
            stored_kind,
            parent_id,
            model.priority(priority),
            model.text_field(title, "work_item.title"),
            model.multiline_field(description, "work_item.description"),
            model.dumps(model.labels(labels)),
            model.text_field(source, "work_item.source", limit=512, required=False),
            basis,
            basis,
            starts,
        ),
    )
    item_projects.replace(conn, item_id, changes)
    opened = target["category"] == model.SERVICE_CATEGORY
    # A goal or stage accepted at once names no state: its opening says where it stands.
    _log(conn, item_id, "created", "" if opened else str(target["key"]), author)
    if basis is not None:
        _log(conn, item_id, "accepted", basis, author)
    if opened:
        _log(conn, item_id, "opened", "", author)
    creator = subscriptions.agent_session(calls.current())
    if stored_kind == model.CONTAINER_KIND and parent_id is None and creator is not None:
        # A goal outlives the subagent that filed it, and its news is for the
        # conversation that leads the work; a stage's come through the goal.
        subscriptions.follow(conn, item_id, creator)
    words.bring_current(conn)
    return read_model.present(conn, read_model.item_by_id(conn, item_id), full=True)


def _placed_space(
    conn: sqlite3.Connection, space: str | None, projects: Sequence[str], parent: str | None
) -> sqlite3.Row:
    """The space a new item lies in: the one it names, held to `item_projects.placement`."""

    named = None if space is None else _space_row(conn, space)
    parent_space = None
    if parent:
        parent_space = str(
            conn.execute(
                "SELECT key FROM planning_spaces WHERE planning_space_id = ?",
                (str(read_model.item_row(conn, parent)["planning_space_id"]),),
            ).fetchone()["key"]
        )
    key = item_projects.placement(
        conn,
        space=None if named is None else str(named["key"]),
        projects=projects,
        parent_space=parent_space,
        session_id=calls.confirmed_session(),
    )
    return named if named is not None and str(named["key"]) == key else _space_row(conn, key)


def update_work_item(
    conn: sqlite3.Connection,
    reference: str,
    *,
    title: str | None = None,
    description: str | None = None,
    source: str | None = None,
    priority: str | None = None,
    labels: object = None,
    labels_add: object = None,
    labels_remove: object = None,
    kind: str | None = None,
    parent: str | None = None,
    projects: object = None,
    expected_revision: int | None = None,
    author: str | None = None,
) -> dict:
    """Edit the fields a transition does not own: one guarded write, one revision.

    `labels` replaces the set; `labels_add` and `labels_remove` change the set the
    item has, read under the write lock (`model.edited_labels`). An edit that
    changes the set is the one edit the history records: a `labels_changed` event
    with the set before and after (`model.labels_change`), under `author`.
    `projects` replaces the projects the item names, each then `named`
    (`item_projects.replace`); the item stays in its space. It is an edit with no
    history event.
    """

    row = _row_for_write(conn, reference, expected_revision)
    changes = item_projects.named(projects)
    if changes is not None:
        item_projects.require_nameable(changes, container=row["kind"] == model.CONTAINER_KIND)
    current = model.labels(json.loads(str(row["labels"])))
    labels = model.edited_labels(current, labels, labels_add, labels_remove)
    change = model.labels_change(current, labels)
    if change is not None:
        # The event is written after the edit, under this author: an author the history
        # cannot hold is refused here, while the store is still untouched.
        model.actor(author)
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
        parameters.append(model.dumps(labels))
    if kind is not None:
        updates.append("kind = ?")
        parameters.append(_edited_kind(row, kind))
    left: str | None = None
    if parent is not None:
        parent_row = _parent_row(
            conn, str(row["planning_space_id"]), parent, item_id=str(row["work_item_id"])
        )
        moved_to = str(parent_row["work_item_id"]) if parent_row is not None else None
        updates.append("parent_id = ?")
        parameters.append(moved_to)
        if row["parent_id"] is not None and str(row["parent_id"]) != moved_to:
            left = str(row["parent_id"])
    reprojected = changes is not None and item_projects.differs(
        conn, str(row["work_item_id"]), changes
    )
    edited = ",".join(
        name
        for name in (_edited(row, updates, parameters), "projects" if reprojected else None)
        if name
    )
    if edited:
        calls.call_id(conn, str(row["work_item_id"]), edited=edited)
    if not updates and not reprojected:
        return read_model.present(conn, row, full=True)
    _write(conn, row, updates, parameters)
    if reprojected and changes is not None:
        item_projects.replace(conn, str(row["work_item_id"]), changes)
    if left is not None:
        # The container keeps that it had this child: what it derives counts the child.
        _log(conn, left, "child_left", read_model.reference(conn, row), author)
    # Any other field's edit is no audited action; the revision and the call row carry it.
    if change is not None:
        _log(
            conn,
            str(row["work_item_id"]),
            "labels_changed",
            change,
            author,
            limit=model.LABELS_DETAIL_LIMIT,
        )
    words.bring_current(conn)
    return read_model.present(
        conn, read_model.item_by_id(conn, str(row["work_item_id"])), full=True
    )


def _edited_kind(row: sqlite3.Row, kind: str) -> str:
    """The stored kind an edit of `kind` leaves, refused where an edit cannot change it.

    An edit changes a task's kind among the task kinds. A task becomes a goal or
    stage, and back, by converting it, which is an action of its own; whether a
    container is a goal or a stage follows from whether it stands under a parent.
    """

    named = model.public_kind(kind)
    container = row["kind"] == model.CONTAINER_KIND
    if container and named == read_model.outward_kind(row["kind"], row["parent_id"]):
        return model.CONTAINER_KIND
    if container or named not in model.TASK_KINDS:
        raise model.PlanningError(
            "an edit changes kind among task, bug and improvement; a task and a goal or stage"
            " become each other by conversion, and goal or stage follows from the parent"
        )
    return model.work_item_kind(named)


def _edited(row: sqlite3.Row, updates: list[str], parameters: list[object]) -> str | None:
    """The fields an edit changes, for its call row; one sent with its own value is not."""

    columns = (update.split(" ", 1)[0] for update in updates)
    changed = [
        column for column, value in zip(columns, parameters, strict=True) if row[column] != value
    ]
    return ",".join(changed) or None


def delete_work_item(conn: sqlite3.Connection, reference: str) -> dict:
    # Under the lock, so a child created meanwhile is counted here and refused
    # in words, rather than met by the DELETE as a raw FOREIGN KEY failure.
    row = _row_for_write(conn, reference, None)
    children = conn.execute(
        "SELECT COUNT(*) FROM work_items WHERE parent_id = ?", (str(row["work_item_id"]),)
    ).fetchone()[0]
    if children:
        raise model.PlanningError(
            f"{read_model.reference(conn, row)} still has {children} child item(s); move or delete them first"
        )
    identity = str(row["work_item_id"])
    pictures = images.held(conn, identity)
    conn.execute("DELETE FROM work_items WHERE work_item_id = ?", (identity,))
    # The rows went with the item; a file no other item holds goes once this commits.
    images.release(conn, pictures)
    words.bring_current(conn)
    return {
        "work_item_id": row["work_item_id"],
        "reference": read_model.reference(conn, row),
        "deleted": True,
    }


def pin_work_item(conn: sqlite3.Connection, reference: str, pinned: bool) -> str:
    """Pin an item for the person, or take the pin away; the id of the item.

    A pin is the person's own list, not a change to the item: no event, no
    revision, nothing an agent is told. The call still has its row, naming the
    item, as every write's does. A pin already as asked writes nothing more, and
    one taken away goes with nothing else; deleting the item takes it by cascade.
    """

    if not isinstance(pinned, bool):
        raise model.PlanningError("pinned must be a boolean")
    row = _row_for_write(conn, reference, None)
    identity = str(row["work_item_id"])
    call = calls.call_id(conn, identity)
    if pinned:
        conn.execute(
            "INSERT OR IGNORE INTO pinned_work_items(work_item_id, call_id) VALUES (?, ?)",
            (identity, call),
        )
    else:
        conn.execute("DELETE FROM pinned_work_items WHERE work_item_id = ?", (identity,))
    return identity


def list_pins(conn: sqlite3.Connection, spaces: list[str]) -> list[dict]:
    """The pins of these spaces' items, by space key and number, as an export carries them."""

    return [
        {
            "reference": f"{row['key']}-{row['number']}",
            "work_item_id": str(row["work_item_id"]),
            "pinned_at": str(row["pinned_at"]),
        }
        for row in conn.execute(
            "SELECT p.key, i.number, i.work_item_id, n.pinned_at FROM pinned_work_items n"
            " JOIN work_items i ON i.work_item_id = n.work_item_id"
            " JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id"
            " WHERE i.planning_space_id IN (SELECT value FROM json_each(?))"
            " ORDER BY p.key, i.number",
            (json.dumps(spaces),),
        )
    ]


#: The most characters one event's detail may hold; `_log` refuses a longer one.
EVENT_DETAIL_LIMIT = 512


def transition_reason(reason: str, state_key: str) -> str:
    """The reason a transition records, sized to the event it is written into.

    The event's detail reads `<state key>: <reason>`, so the reason may use only
    the characters the state key leaves. Checking it before the write refuses a
    long reason by its own name, with nothing written. The reason is never cut to
    fit: a shortened reason loses what the caller wrote.
    """

    if not reason.strip():
        return ""
    return model.text_field(reason, "reason", limit=EVENT_DETAIL_LIMIT - len(f"{state_key}: "))


def transition_work_item(
    conn: sqlite3.Connection,
    reference: str,
    state: str,
    *,
    reason: str = "",
    force: bool = False,
    expected_revision: int | None = None,
    author: str | None = None,
    acceptance: object = None,
    to_check: object = None,
) -> dict:
    """Move an item to a state; the order of work places it there (`queue.list_key`).

    Any state but an active or a blocked one ends every claim on the item in the
    same write: a claim says somebody is working it, and nobody works an item in
    triage, ready, review or a closed one. Closed items used to keep a live claim
    until a second call released it, or until the lease ran out a fortnight
    later, and read as held all that time. The holder is not lost: the
    `released` event names it, and the read model's `last_claim_ref` reads it
    back. A step claim ends too; the open steps of a cancelled or forced close
    stay open, unheld. Reopening the item later restores nothing.

    Moving into accepted work gives an item with no basis the one the order of
    bases says (`_given`): `acceptance` is the basis an agent names, and a move
    that finds none is refused. A goal or stage moved to ready is accepted: it
    stands in the service state, the history says `opened` rather than naming a
    state, and accepted from triage or deferred it takes the work waiting in
    triage under it along (`_cascade`). The refusals of `transitions.UNFORCED`
    hold against `force`.

    A move into review asks the owner, in the same write, the question `to_check`
    words: what to check, answered by accepting the work or returning it
    (`requests.carry_out`); the answer names it as `review_request_id`. The question
    lasts while the item stays in review: any other way out ends it, a close as a
    close ends every request and any other move as withdrawn.
    """

    return _transition(
        conn,
        reference,
        state,
        reason=reason,
        force=force,
        expected_revision=expected_revision,
        author=author,
        acceptance=acceptance,
        to_check=to_check,
    )


#: The refusal a launch's put-back is spared: it returns a task to where it stood.
_PUT_BACK_SPARES = frozenset({"deferred"})


def put_back_after_launch(
    conn: sqlite3.Connection,
    reference: str,
    state: str,
    *,
    expected_revision: int,
    author: str,
) -> dict:
    """Put a task a failed launch started back in the state the launch found it in.

    The launch's claim moved the task to work and the client never started, so
    nothing happened that the move could stand for. Going back is forced, as the
    compensation always was, and it is the one write that may enter deferred: the
    task is not being deferred, only put back where it stood. The move ends the
    launch's claim like any move out of work, and a move back to triage or deferred
    takes away the basis the claim gave. Nothing on a surface reaches this: a
    create, a move and `force` keep refusing entry into deferred.
    """

    return _transition(
        conn,
        reference,
        state,
        reason="launch_failed",
        force=True,
        expected_revision=expected_revision,
        author=author,
        spared=_PUT_BACK_SPARES,
    )


def _transition(
    conn: sqlite3.Connection,
    reference: str,
    state: str,
    *,
    reason: str = "",
    force: bool = False,
    expected_revision: int | None = None,
    author: str | None = None,
    acceptance: object = None,
    spared: frozenset[str] = frozenset(),
    to_check: object = None,
) -> dict:
    """`transition_work_item`, sparing the refusals named in `spared`."""

    row = _row_for_write(conn, reference, expected_revision)
    named = model.named_basis(acceptance)
    identity = str(row["work_item_id"])
    current = read_model.state_by_id(conn, str(row["state_id"]))
    target = _destination(conn, row, states.resolve(conn, str(row["workflow_id"]), state))
    opened = target["category"] == model.SERVICE_CATEGORY
    if opened and current["state_id"] == target["state_id"]:
        answer = read_model.present(conn, row, full=True)
        answer["warnings"] = [f"{read_model.reference(conn, row)} is accepted and open already"]
        return answer
    into_review = (
        target["category"] == transitions.REVIEW and current["category"] != transitions.REVIEW
    )
    out_of_review = (
        current["category"] == transitions.REVIEW and target["category"] != transitions.REVIEW
    )
    check = _to_check(to_check, into_review, target)
    note = transition_reason(reason, str(target["key"]))
    gives = _basis(conn, row, target, named)
    refusals, warnings = transitions.findings(
        conn, row, target, reason=reason, basis=row["acceptance"] or gives, to_check=check
    )
    refusals = [finding for finding in refusals if finding[0] not in spared]
    transitions.refuse(refusals, force)
    updates = ["state_id = ?"]
    parameters: list[object] = [str(target["state_id"])]
    updates += _accepting(row, target, gives, parameters)
    # Only a task at work, or blocked at it, has a holder: anywhere else the move ends
    # every claim on the item in the same write.
    releasing = target["category"] not in model.HELD_CATEGORIES
    held = str(row["claim_ref"]) if releasing else ""
    steps = model.checklist(row["checklist"])
    unheld = [step for step in steps if releasing and step["claimed_by"]]
    if held:
        updates += ["claim_ref = ?", "claim_call_id = ?"]
        parameters += ["", None]
    if unheld:
        for step in unheld:
            step["claimed_by"] = ""
        updates.append("checklist = ?")
        parameters.append(model.dumps(steps))
    _write(conn, row, updates, parameters)
    if gives is not None:
        _log(conn, identity, "accepted", gives, author)
    if opened:
        # Entering the service state names no state: it is the goal's or stage's opening.
        _log(conn, identity, "opened", note, author)
    else:
        _log(
            conn,
            identity,
            "transitioned",
            f"{target['key']}: {note}" if note else str(target["key"]),
            author,
        )
    if held:
        _log(conn, identity, "released", held, author)
    for step in unheld:
        _log(conn, identity, "checklist_released", step["text"][:120], author)
    if target["is_terminal"]:
        # A close ends what still waits on the item, saying how it closed; reopening
        # brings none of it back.
        questions.end(conn, identity, questions.closed_reason(str(target["category"])), author)
    elif out_of_review:
        # The question of review is about the work as it stood there: a move that takes
        # the item elsewhere takes it back.
        questions.end(conn, identity, "withdrawn", author, purpose=transitions.REVIEW)
    asked = None
    if into_review:
        asked = questions.ask(
            conn,
            identity,
            kind="question",
            prompt=check,
            fields=request_model.fields(list(request_model.REVIEW_FIELDS)),
            author=author,
            purpose=transitions.REVIEW,
        )
    # Out of triage or deferred the item had no basis, so the move that accepts it gave one.
    if opened and gives is not None and current["category"] in model.UNACCEPTED_CATEGORIES:
        # The order of bases for what is under it, read with the item now accepted.
        under = "inherited" if item_tree.accepted_chain(conn, identity) else gives
        warnings += _cascade(conn, identity, read_model.reference(conn, row), under, author)
    overridden = _record_overrides(conn, identity, [guard for guard, _ in refusals], author)
    answer = read_model.present(conn, read_model.item_by_id(conn, identity), full=True)
    answer["warnings"] = warnings
    if held:
        answer["released"] = held
    if overridden:
        answer["overridden"] = overridden
    if asked is not None:
        answer["review_request_id"] = asked
    return answer


def _to_check(value: object, into_review: bool, target: sqlite3.Row) -> str:
    """What the owner is to check, as a move into review asks it; refused on any other move.

    Sent with a move that does not enter review it would ask nothing, so it is refused
    rather than dropped: the caller meant a question that would never be asked.
    """

    if value is None:
        return ""
    if not into_review:
        raise model.PlanningError(
            f"to_check goes with a move into review, which asks it; a move to {target['name']}"
            " asks nothing: leave it out"
        )
    return model.multiline_field(value, "to_check", limit=_TO_CHECK_LIMIT)


#: The most characters `to_check` holds: as many as any question's prompt.
_TO_CHECK_LIMIT = 8000


def _destination(
    conn: sqlite3.Connection, row: Mapping[str, object] | sqlite3.Row, target: sqlite3.Row
) -> sqlite3.Row:
    """Where a move to `target` puts the item: for a goal or stage, ready is its acceptance.

    Ready means decided upon, and a container decided upon stands in the service
    state. A workflow without one keeps the state named, which the container refusal
    then stops.
    """

    if row["kind"] != model.CONTAINER_KIND or target["category"] != "ready":
        return target
    found = states.first_state(conn, str(row["workflow_id"]), model.SERVICE_CATEGORY)
    return target if found is None else found


def _entry_basis(named: str | None) -> str | None:
    """The basis a write's own way in gives: the owner's write, or an agent naming it."""

    return "owner" if calls.by_person() else named


def _given(conn: sqlite3.Connection, parent_id: object, entry: str | None) -> str | None:
    """The basis by the one order every way in follows: the accepted chain, then the entry."""

    if item_tree.accepted_chain(conn, None if parent_id is None else str(parent_id)):
        return "inherited"
    return entry


def _basis(
    conn: sqlite3.Connection, row: sqlite3.Row, target: sqlite3.Row, named: str | None
) -> str | None:
    """The basis a move to `target` writes, or None when it writes none.

    Only a move into accepted work gives one, and only to an item that has none:
    accepted work keeps the basis it was accepted on, through a close and a reopening.
    """

    if target["category"] not in model.ACCEPTED_CATEGORIES or row["acceptance"] is not None:
        return None
    return _given(conn, row["parent_id"], _entry_basis(named))


def _accepting(
    row: sqlite3.Row, target: sqlite3.Row, gives: str | None, parameters: list[object]
) -> list[str]:
    """The columns a move into `target` sets beside the state, in the same UPDATE.

    The store refuses accepted work with no basis on every statement, so the state
    and its basis change together: a basis given, or taken away by triage, and the
    start a task records the first time it reaches work.
    """

    updates: list[str] = []
    if gives is not None:
        updates += ["acceptance = ?", f"accepted_at = {_NOW}"]
        parameters.append(gives)
    elif target["category"] in model.UNACCEPTED_CATEGORIES and row["acceptance"] is not None:
        updates += ["acceptance = NULL", "accepted_at = NULL"]
    if (
        row["kind"] != model.CONTAINER_KIND
        and row["started_at"] is None
        and target["category"] in model.STARTING_CATEGORIES
    ):
        updates.append(f"started_at = {_NOW}")
    return updates


def _cascade(
    conn: sqlite3.Connection, identity: str, accepted: str, basis: str, author: str | None
) -> list[str]:
    """Accept the work waiting in triage under a container accepted in this write.

    Its tasks go to the first ready state they can reach and its goals and stages
    stand accepted, each on `basis`, with `accepted` and the entry written; the
    containers accepted with it are descended into. A deferred container stops the
    descent: what is under it keeps a container above it that is not accepted.
    Anything else is not waiting to be accepted and stays as it is.

    `basis` is the order of bases read once for the whole descent, since every item
    it reaches has the same containers above it that are not accepted with it:
    `inherited` when, with this container accepted, every one up to the root stands
    accepted and open, and otherwise the basis of the write that accepted it.
    """

    warnings: list[str] = []
    children = conn.execute(
        "SELECT i.* FROM work_items i JOIN workflow_states s ON s.state_id = i.state_id"
        " WHERE i.parent_id = ? AND s.category = 'triage' ORDER BY i.number",
        (identity,),
    ).fetchall()
    for child in children:
        container = child["kind"] == model.CONTAINER_KIND
        target = states.reachable(conn, child, model.SERVICE_CATEGORY if container else "ready")
        if target is None:
            warnings.append(
                f"{read_model.reference(conn, child)} stays in triage: its workflow has no"
                " state of accepted work it can move to"
            )
            continue
        parameters: list[object] = [str(target["state_id"])]
        updates = ["state_id = ?", *_accepting(child, target, basis, parameters)]
        _write(conn, child, updates, parameters)
        found = str(child["work_item_id"])
        _log(conn, found, "accepted", basis, author)
        if container:
            _log(conn, found, "opened", "", author)
            warnings += _cascade(conn, found, accepted, basis, author)
        else:
            _log(conn, found, "transitioned", f"{target['key']}: accepted with {accepted}", author)
    return warnings


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

    An abandoned lease (`leases.abandoned`) is released before anything else,
    with the steps its holder held and every lapsed one, so taking it over needs
    no `force` and the history shows the expiry and the claim as two events. The
    one exception is the holding session itself: it is still the holder, and
    its own call has just counted as its heartbeat.

    Nothing but a task is held, and only at work or blocked at it (`_holdable`).
    Taking an item that has not started starts it in the same write (`_starting`),
    and `start_reason` is what that transition records. Releasing an item under way
    puts it back in the queue (`_settle`). `move_state=False` starts nothing, for a
    caller that sets the state itself: a launch putting back what it found. It then
    holds only work at work or blocked, and its release still puts work nobody holds
    back in the queue: nothing at work stands unheld.
    """

    row = _row_for_write(conn, reference, expected_revision)
    if not release:
        _holdable(conn, row)
    # `actor` is what the caller signs; `label` what it holds as. An unconfirmed
    # lease is still compared by the signature, as every claim was before.
    actor = model.actor(author)
    label = calls.holder(author)
    caller = calls.current()
    lease = leases.lease(conn, row)
    expired = False
    if lease is not None and leases.abandoned(lease) and not leases.held_by(lease, caller, actor):
        row = _expire(conn, row, lease, _lapsed_steps(conn, row, lease))
        lease, expired = None, True
    held = lease.holder if lease is not None else ""
    holder = lease is not None and leases.held_by(lease, caller, actor)
    identity = str(row["work_item_id"])
    carried: list[str] = []
    start: _Start | None = None
    if release:
        if expired:
            # The lease this release named is already gone, released above.
            return read_model.present(conn, row, full=True)
        if lease is not None and not holder:
            if not force:
                raise model.PlanningError(
                    f"{read_model.reference(conn, row)} is held by {held}, not by you"
                )
            carried.append("claim")
        _keep_held(conn, row, "", row["checklist"])
        _hold(conn, row, "")
        _log(conn, identity, "released", held, author)
    else:
        start = _starting(conn, row, move_state)
        taking_over = lease is not None and not holder
        if taking_over and not force:
            raise model.PlanningError(
                f"{read_model.reference(conn, row)} is already held by {held};"
                " pass force to take the work over"
            )
        try:
            _hold(conn, row, label, start.updates, start.parameters)
        except model.RevisionConflictError:
            if taking_over:
                raise
            return _claim_lost(conn, row, actor)
        if taking_over:
            carried.append("claim")
            _log(conn, identity, "taken_over", held, author)
        else:
            _log(conn, identity, "claimed", "", author)
        _started(conn, identity, start, author, start_reason)
        waiting.deliver(conn, row)
    overridden = _record_overrides(conn, identity, carried, author)
    requeued = _settle(conn, identity, author, "released") if release else None
    answer = read_model.present(conn, read_model.item_by_id(conn, identity), full=True)
    if requeued is not None:
        answer["requeued"] = requeued
    if start is not None:
        _say_started(conn, answer, start)
    if overridden:
        answer["overridden"] = overridden
    return answer


def _holdable(conn: sqlite3.Connection, row: sqlite3.Row) -> None:
    """Refuse a claim, of the item or of a step, on what nobody holds.

    One refusal for every way in -- a claim, the queue, a batch, a creation that
    claims, HTTP and a launch -- before anything is written. A goal or stage is
    never held; an item in review waits on the owner's answer, and a closed one is
    reopened before anybody works it again.
    """

    if row["kind"] == model.CONTAINER_KIND:
        raise model.container_unheld()
    category = str(read_model.state_by_id(conn, str(row["state_id"]))["category"])
    if category == "review":
        raise model.WorkflowGuardError(
            f"[review] {read_model.reference(conn, row)} is in review: the owner's answer"
            " decides, and it returns the task to ready"
        )
    if category in model.TERMINAL_CATEGORIES:
        raise model.WorkflowGuardError(
            f"[closed] {read_model.reference(conn, row)} is closed; reopen it first"
        )


@dataclasses.dataclass(frozen=True)
class _Start:
    """What a claim writes beside its holder: the state it starts in, the basis, the start."""

    updates: list[str]
    parameters: list[object]
    current: sqlite3.Row | None = None
    target: sqlite3.Row | None = None
    gives: str | None = None


def _starting(conn: sqlite3.Connection, row: sqlite3.Row, move_state: bool = True) -> _Start:
    """What taking this task writes beside its holder, decided before anything is written.

    A claim is the moment work starts, and an item left in triage while an agent
    worked it told everyone reading the board that nobody had begun. So a task in
    triage, deferred or ready moves to the first active state its workflow lets it
    reach, accepted by the order of bases if it was not, with a claim's own basis:
    the owner's when the person claims, an assignment otherwise. A task already at
    work or blocked stays where it is. The first claim records the start. A task
    with no active state to reach is refused: a holder stands nowhere else.
    """

    parameters: list[object] = []
    current = read_model.state_by_id(conn, str(row["state_id"]))
    if not move_state:
        # The caller set the state itself, and a holder stands only where work is held.
        if current["category"] not in model.HELD_CATEGORIES:
            raise model.WorkflowGuardError(
                f"[transition] {read_model.reference(conn, row)} stands in {current['name']}:"
                " a claim that moves no state holds only work under way or blocked"
            )
        return _Start([], [])
    if current["category"] not in states.STARTABLE:
        updates = [f"started_at = {_NOW}"] if row["started_at"] is None else []
        return _Start(updates, parameters)
    reference = read_model.reference(conn, row)
    target = states.start_state(conn, row)
    if target is None:
        raise model.WorkflowGuardError(
            f"[transition] {reference} stays in {current['name']}: its workflow has no active"
            " state it can move to"
        )
    gives = _basis(conn, row, target, model.NAMED_BASIS)
    refusals, _warnings = transitions.findings(
        conn, row, target, basis=row["acceptance"] or gives, held=True
    )
    transitions.refuse(refusals, False)
    parameters.append(str(target["state_id"]))
    updates = ["state_id = ?", *_accepting(row, target, gives, parameters)]
    return _Start(updates, parameters, current, target, gives)


def _started(
    conn: sqlite3.Connection, identity: str, start: _Start, author: str | None, reason: str
) -> None:
    """The history of the start a claim wrote with its holder: the basis, then the move."""

    if start.gives is not None:
        _log(conn, identity, "accepted", start.gives, author)
    if start.target is not None:
        _log(conn, identity, "transitioned", f"{start.target['key']}: {reason}", author)


def _say_started(conn: sqlite3.Connection, answer: dict, start: _Start) -> None:
    """Name in a claim's answer where it started the item from and went, and its warnings."""

    if start.target is None or start.current is None:
        return
    answer["started"] = {"from": str(start.current["key"]), "to": str(start.target["key"])}
    row = read_model.item_by_id(conn, str(answer["work_item_id"]))
    warning = transitions.lease_warning(conn, row, str(answer["reference"]))
    if warning:
        answer["warnings"] = [warning]


#: The items a write in progress left without the holder their state needs, when it
#: is one write of several steps (`one_write`); None outside one.
_UNSETTLED: contextvars.ContextVar[dict[str, tuple[str | None, str]] | None] = (
    contextvars.ContextVar("planning_unsettled", default=None)
)


@contextlib.contextmanager
def one_write(conn: sqlite3.Connection) -> Iterator[None]:
    """Hold the holder rule to the end of several steps that are one write.

    A batch is one write: a task at work that lost its last holder in one step and
    went to review in the next went from work to review, not by way of ready. So
    inside this block `_settle` only notes the item, and the end of the block
    settles each item once, as the last step left it.
    """

    pending: dict[str, tuple[str | None, str]] = {}
    token = _UNSETTLED.set(pending)
    try:
        yield
    finally:
        _UNSETTLED.reset(token)
    for identity, (author, reason) in pending.items():
        _hand_back(conn, identity, author, reason)


def _settle(
    conn: sqlite3.Connection, identity: str, author: str | None, reason: str
) -> dict | None:
    """Hold a task at work to having a holder, at the end of the write that is changing it.

    Outside `one_write` that end is now, and the answer is the move `_hand_back`
    made, for the caller's `requeued`; inside one the item waits for its end.
    """

    pending = _UNSETTLED.get()
    if pending is None:
        return _hand_back(conn, identity, author, reason)
    pending.setdefault(identity, (author, reason))
    return None


def _hand_back(
    conn: sqlite3.Connection, identity: str, author: str | None, reason: str
) -> dict | None:
    """Put a task at work that nobody holds any more back where the take-next queue finds it.

    The other half of `_starting`. A task at work always has a holder, so when the
    last one goes -- the claim released or expired, the last claimed step released,
    ticked or dropped, and nobody holding the item -- the task goes back to the
    first ready state its workflow lets it reach, started as it was; the answer is
    that move, for the caller's `requeued`, or None. Never to triage instead, which
    would take its acceptance away unseen: with no ready state to reach, the write
    that let the last holder go is refused, since nothing at work stands unheld.
    Its checklist, comments and history stay. A task with a claim or a claimed step
    left stays active; a blocked task stays blocked, unheld.
    """

    row = read_model.item_by_id(conn, identity)
    current = read_model.state_by_id(conn, str(row["state_id"]))
    if not _unheld_at_work(current, row["claim_ref"], row["checklist"]):
        return None
    target = states.queue_state(conn, row)
    if target is None:
        raise _stranded(conn, row)
    _write(conn, row, ["state_id = ?"], [str(target["state_id"])])
    _log(conn, identity, "transitioned", f"{target['key']}: {reason}", author)
    return {"from": str(current["key"]), "to": str(target["key"])}


def _unheld_at_work(current: sqlite3.Row, claim_ref: str, checklist: object) -> bool:
    """Whether a task stands at work with nobody holding it or any of its steps."""

    return (
        current["category"] == "active"
        and not claim_ref
        and not any(step["claimed_by"] for step in model.checklist(checklist))
    )


def _stranded(conn: sqlite3.Connection, row: sqlite3.Row) -> model.WorkflowGuardError:
    return model.WorkflowGuardError(
        f"[transition] {read_model.reference(conn, row)} would stand at work with nobody"
        " holding it: its workflow lets it reach no ready state to go back to; move it first"
    )


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


def expire_leases(
    conn: sqlite3.Connection, *, space_id: str | None = None, limit: int | None = None
) -> int:
    """Release every lapsed hold, in one space or all; on how many items it released one.

    A hold is an item's claim or a claimed step of it, and each lapses by its
    lease (`leases.lapsed`): a session's after its silence or past the grace of
    its end, one no session proved after its item's quiet. An open question to
    the owner on the item stops the count of silence for every hold there. A
    lease in its grace waits for its session to come back, since nobody asked
    for that item in particular. An item another writer changed in the meantime
    is left to it. With `limit`, it stops after releasing on that many items, by
    number, and leaves the rest to the next call.
    """

    expired = 0
    for row, claim, steps in lapsed_holds(conn, space_id=space_id):
        if limit is not None and expired >= limit:
            break
        try:
            _expire(conn, row, claim, steps)
        except model.RevisionConflictError:
            continue
        expired += 1
    return expired


def lapsed_holds(
    conn: sqlite3.Connection, *, space_id: str | None = None
) -> Iterator[tuple[sqlite3.Row, leases.Lease | None, dict[str, leases.Lease]]]:
    """Each item `expire_leases` would release a hold on, by number: its row, claim and steps.

    The claim is the lapsed lease to release, or None when only steps lapsed. It
    only reads, so a caller that asks whether there is anything to release takes
    no write lock; an item whose release would leave it at work unheld for good
    (`_strands`) is not one.
    """

    clauses = [
        "s.is_terminal = 0",
        "(i.claim_ref != '' OR EXISTS (SELECT 1 FROM json_each(i.checklist) j"
        " WHERE json_extract(j.value, '$.claimed_by') != ''))",
    ]
    parameters: list[object] = []
    if space_id is not None:
        clauses.append("i.planning_space_id = ?")
        parameters.append(space_id)
    query = with_clauses(
        "SELECT i.* FROM work_items i JOIN workflow_states s ON s.state_id = i.state_id", clauses
    )
    for row in conn.execute(query + " ORDER BY i.number", parameters).fetchall():
        asked = leases.question_stands(conn, row)
        lease = leases.lease(conn, row, asked=asked)
        claim = lease if lease is not None and leases.lapsed(lease) else None
        steps = _lapsed_steps(conn, row, claim, asked=asked)
        if claim is None and not steps:
            continue
        left = model.checklist(row["checklist"])
        for step in left:
            if step["id"] in steps:
                step["claimed_by"] = ""
        if _strands(conn, row, "" if claim is not None else str(row["claim_ref"]), left):
            # Its release would leave it at work unheld: the hold stays until it moves.
            continue
        yield row, claim, steps


def _lapsed_steps(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    claim: leases.Lease | None,
    *,
    asked: bool | None = None,
) -> dict[str, leases.Lease]:
    """The claimed steps of the item to release, by step id, each with its lease.

    A lapsed one, and, beside a claim being released, every step of the same
    holder: the lease is the session's, so what lapses for its claim lapses for
    its steps.
    """

    if asked is None:
        asked = leases.question_stands(conn, row)
    found: dict[str, leases.Lease] = {}
    read: dict[str, leases.Lease] = {}
    for step in model.checklist(row["checklist"]):
        holder = str(step["claimed_by"] or "")
        if step["done"] or not holder:
            continue
        if holder not in read:
            read[holder] = leases.of_step(conn, row, holder, asked=asked)
        held = read[holder]
        if leases.lapsed(held) or (claim is not None and _same_holder(held, claim)):
            found[str(step["id"])] = held
    return found


def _same_holder(step: leases.Lease, claim: leases.Lease) -> bool:
    """Whether a step stands on the lease of the claim: its session, or its unproved name."""

    if claim.session_id is not None:
        return step.session_id == claim.session_id
    return step.state == leases.UNCONFIRMED and step.holder == claim.holder


def _strands(conn: sqlite3.Connection, row: sqlite3.Row, claim_ref: str, checklist: object) -> bool:
    """Whether the item, held as `claim_ref` and `checklist` say, is at work unheld for good.

    For good: nobody holds it or a step of it and there is no ready state to put it
    back in, so `_hand_back` could only refuse.
    """

    current = read_model.state_by_id(conn, str(row["state_id"]))
    let_go = _unheld_at_work(current, claim_ref, checklist)
    return let_go and states.queue_state(conn, row) is None


def _keep_held(
    conn: sqlite3.Connection, row: sqlite3.Row, claim_ref: str, checklist: object
) -> None:
    """Refuse a write that would leave the item as `_strands` says, before it writes anything.

    Inside `one_write` a later step may still move the item, so its end decides.
    """

    if _UNSETTLED.get() is None and _strands(conn, row, claim_ref, checklist):
        raise _stranded(conn, row)


def _expire(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    claim: leases.Lease | None,
    steps: Mapping[str, leases.Lease],
) -> sqlite3.Row:
    """Release lapsed holds as one write of Valkama's own, and return the row after it.

    `claim` is the item's lease to release, or None to keep it; `steps` the
    claimed steps to release, by id. The only path an expiry takes, for the
    sweep, the take-next queue and a claim by number alike. The release is its
    own call, so the history says who released it and why rather than charging
    the expiry to whichever caller happened to meet it: `released` with the
    claim's reason and holder, `checklist_released` with each step's text. The
    why of the move back to the queue is the claim's reason, else a step's.

    Every step a lapsed holder ticked is marked `by_previous_holder` in the same
    write, whatever state the item stands in: nobody is left to stand behind
    that tick, so a later holder confirms it before review or a close. A tick
    someone else made is theirs and stays as it is.

    What a person said over the work after a lapsed session's last call reached
    nobody, so the same call leaves it for the next session (`waiting.recover`),
    for every lease it releases that a session held, before a claim that met the
    lapsed lease looks for words to take.
    """

    identity = str(row["work_item_id"])
    checklist = model.checklist(row["checklist"])
    released = [step for step in checklist if step["id"] in steps]
    for step in released:
        step["claimed_by"] = ""
    gone = [lease for lease in (claim, *steps.values()) if lease is not None]
    flagged = [
        step
        for step in checklist
        if not step[model.PREVIOUS_HOLDER] and any(_ticked_by(step, lease) for lease in gone)
    ]
    for step in flagged:
        step[model.PREVIOUS_HOLDER] = True
    changed = bool(released or flagged)
    updates: list[str] = ["checklist = ?"] if changed else []
    parameters: list[object] = [model.dumps(checklist)] if changed else []
    reason = claim.reason if claim is not None else next(iter(steps.values())).reason
    with calls.bind(calls.valkama(), leases.EXPIRY_TOOL):
        if claim is not None:
            _hold(conn, row, "", updates, parameters)
            _log(conn, identity, "released", leases.expiry_detail(claim), leases.EXPIRY_AUTHOR)
        else:
            _write(conn, row, updates, parameters)
        for step in released:
            _log(conn, identity, "checklist_released", step["text"][:120], leases.EXPIRY_AUTHOR)
        _hand_back(conn, identity, leases.EXPIRY_AUTHOR, reason)
        waiting.recover(
            conn, [(lease.session_id, identity) for lease in gone if lease.session_id is not None]
        )
    return read_model.item_by_id(conn, identity)


def _ticked_by(step: Mapping[str, object], lease: leases.Lease) -> bool:
    """Whether this step's tick is the lease's holder's: its session, or its unproved name."""

    by = str(step["done_by"] or "")
    if not step["done"] or not by:
        return False
    if lease.session_id is None:
        return by == lease.holder
    ids = calls.holder_ids(by)
    return ids is not None and ids[0] == calls.label_id(lease.session_id)


def claim_ready_work_item(
    conn: sqlite3.Connection,
    *,
    space: str | None = None,
    within: str | None = None,
    label: str | None = None,
    project: str | None = None,
    author: str | None = None,
) -> dict | None:
    """Pick the next task the queue of one space gives and take it.

    The queue gives a task `queue.withheld` names nothing for, read over the
    whole of its space. The next one is the first by the key of work
    (`queue.work_key`) — urgent, started, under way above, priority, age — the
    smaller number first on a tie: the item whose `queue_order` reads 1.

    The space is `space`, else the space of `within`, else the space of the
    calling session (`item_projects.session_space`); a call with none of them is
    refused with the spaces there are (`_queue_scope`). `within`, a goal or
    stage, keeps the tasks under it at any depth, `label` the tasks that carry
    that label themselves, and `project` the tasks that name that project, as the
    list's `project` keeps them, so a task naming none is kept by no project; each
    narrows that one queue, never reorders it.

    Choosing and writing are two statements, so the item chosen can be taken by
    somebody else before this claim lands. The guarded write is what catches
    that, and the loser looks for the next candidate instead of being handed an
    item that is already held — which is how two agents asking at once end up
    with two different items. A caller whose own transaction still holds an
    older view keeps seeing the same candidate, so the attempts are bounded and
    the last refusal is reported rather than looped on forever.
    """

    scope = _queue_scope(conn, space, within, label, project)
    holder = calls.holder(author)
    # An expired lease is not a holder, so the queue sees through it: released
    # first, the item then reads unheld to the rule below. A lease in its grace
    # is still held, so the queue neither gives that item nor releases it.
    expire_leases(conn, space_id=scope.space_id)
    lost: model.RevisionConflictError | None = None
    for _ in range(_READY_CLAIM_ATTEMPTS):
        chosen = _next_given(conn, scope)
        if chosen is None:
            return None
        row = read_model.item_by_id(conn, chosen)
        start = _starting(conn, row)
        try:
            _hold(conn, row, holder, start.updates, start.parameters)
        except model.RevisionConflictError as conflict:
            lost = conflict
            continue
        _log(conn, chosen, "claimed", "", author)
        _started(conn, chosen, start, author, "claimed")
        waiting.deliver(conn, row)
        answer = read_model.present(conn, read_model.item_by_id(conn, chosen), full=True)
        _say_started(conn, answer, start)
        return answer
    if lost is not None:
        raise lost
    raise model.PlanningError("no work item could be claimed")


@dataclasses.dataclass(frozen=True)
class _QueueScope:
    """One queue call's space, and what narrows that space's queue."""

    space_id: str
    within_id: str | None
    label: str | None
    project: str | None


def _queue_scope(
    conn: sqlite3.Connection,
    space: str | None,
    within: str | None,
    label: str | None,
    project: str | None,
) -> _QueueScope:
    """The space a queue call reads and what narrows it, or the refusal that says why not.

    `within` names a goal or stage, of any space when `space` is not given, and
    then its space is the call's; beside `space` it must be of that space. With
    neither, the space is the one whose project root holds the folder of the
    session the call proved: none for a call that proved no session, a session
    whose folder lies under no root bound to a space, or a registry that cannot
    be read, and the call is refused. A label is matched as an item's labels are
    written, and a project as the items name it, so one nothing carries or names
    narrows the queue to nothing rather than being refused; a project of another
    space keeps the tasks of this space that name it.
    """

    named = _space_row(conn, space) if space is not None else None
    within_id = None
    if within is not None:
        row = read_model.item_row(conn, within)
        under = _space_row(conn, row["planning_space_id"])
        reference = model.human_id(str(under["key"]), int(row["number"]))
        if row["kind"] != model.CONTAINER_KIND:
            raise model.PlanningError(
                f"within names a goal or stage; {reference} is a {row['kind']}"
            )
        if named is not None and named["planning_space_id"] != under["planning_space_id"]:
            raise model.PlanningError(
                f"within {reference} is in space {under['key']}, not {named['key']}"
            )
        named = under
        within_id = str(row["work_item_id"])
    if named is None:
        found = item_projects.session_space(conn, calls.confirmed_session())
        named = _space_row(conn, found) if found is not None else None
    if named is None:
        keys = [str(key) for (key,) in conn.execute("SELECT key FROM planning_spaces ORDER BY key")]
        raise model.PlanningError(
            "name a space: no space's project root holds this session's folder; "
            + (f"the spaces are {', '.join(keys)}" if keys else "there is no space yet")
        )
    return _QueueScope(
        space_id=str(named["planning_space_id"]),
        within_id=within_id,
        label=None
        if label is None
        else model.text_field(label, "label", limit=model.MAX_LABEL_LENGTH),
        project=None if project is None else item_projects.project_id(project, "project"),
    )


def _next_given(conn: sqlite3.Connection, scope: _QueueScope) -> str | None:
    """The first item the queue of the scope's space gives, if any: one read of its tree.

    The scope only keeps some of what the queue gives, so the item given is
    the one of those that stands first in the space's own queue. A project keeps
    what `item_projects.naming` names, the rule the list's `project` reads.
    """

    tree = item_tree.of_spaces(conn, [scope.space_id])
    naming = None if scope.project is None else set(item_projects.naming(conn, [scope.project]))
    for row in queue.of_spaces(conn, [scope.space_id], tree):
        identity = str(row["work_item_id"])
        if scope.within_id is not None and scope.within_id not in tree.ancestors(identity):
            continue
        if scope.label is not None and scope.label not in model.labels(json.loads(row["labels"])):
            continue
        if naming is not None and identity not in naming:
            continue
        return identity
    return None


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
    its claim, tick, author and `by_previous_holder`, as stored, so appending
    to a checklist is sending it with
    the new steps after the old. Only a claimed or completed step the new list
    leaves out needs `force`, because only dropping one discards its state.

    A step sent done that was not done is recorded as done by the caller, with
    the `checklist_completed` event a tick would write, so setting a step done
    and ticking it are one history; a step is reopened by a tick, not by
    leaving `done` out. A step that names an `id` the item does not have is one
    being carried over from elsewhere, and keeps the state it carries.
    """

    row = _row_for_write(conn, reference, expected_revision)
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
    guards: list[str] = []
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
            theirs = bool(held) and held not in (label, model.actor(author))
            # The tick's own guard: completing a step someone else holds is
            # theirs to do, whichever write sends it.
            if theirs and not force:
                raise model.PlanningError(
                    f"that step is claimed by {held}; pass force to complete it anyway"
                )
            if theirs:
                guards.append("checklist_claim")
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
    if dropped:
        guards.append("checklist_discard")
    for step in completed:
        step["done_by"] = label
        step[model.PREVIOUS_HOLDER] = False
    _keep_held(conn, row, str(row["claim_ref"]), replacement)
    identity = str(row["work_item_id"])
    _write_checklist(conn, row, replacement, completed, author)
    overridden = _record_overrides(conn, identity, guards, author)
    # A step completed or dropped here ends its claim, which may have been the last holder.
    _settle(conn, identity, author, "steps replaced")
    answer = read_model.present(conn, read_model.item_by_id(conn, identity), full=True)
    if overridden:
        answer["overridden"] = overridden
    return answer


def _write_checklist(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    replacement: list[dict],
    completed: list[dict],
    author: str | None,
) -> None:
    """Write the steps and their history: the replacement, then each step it completed."""

    _write(conn, row, ["checklist = ?"], [model.dumps(replacement)])
    identity = str(row["work_item_id"])
    _log(conn, identity, "checklist_replaced", str(len(replacement)), author)
    for step in completed:
        _log(conn, identity, "checklist_completed", step["text"][:120], author)


def _record_overrides(
    conn: sqlite3.Connection, identity: str, guards: list[str], author: str | None
) -> list[str]:
    """Record the refusals a `force` carried through, as one `overridden` event; the guards named.

    Every forced write records through here, in the shape a forced transition
    always had: one event whose detail names the guards, and the same guards in
    the answer. Nothing is written when `force` refused nothing.
    """

    names = list(dict.fromkeys(guards))
    if names:
        _log(conn, identity, "overridden", "; ".join(names), author)
    return names


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
    """Take, release or take over one step of an item.

    A step is part of a task, so it is held where the task may be: refused as a
    claim of the item is (`_holdable`), and a claim of a step on a task that has not
    started starts it in the same write, as a claim of the item does. Releasing the
    last claimed step of a task at work that nobody else holds puts it back in the
    queue (`_settle`).
    """

    row = _row_for_write(conn, reference, expected_revision)
    if not release:
        _holdable(conn, row)
    steps = model.checklist(row["checklist"])
    step = _step(steps, item_id, conn, row)
    label = calls.holder(author)
    held = step["claimed_by"]
    # A step held under the caller's signature is the caller's too: that is how
    # every step was held before a session could hold one.
    mine = held in (label, model.actor(author))
    carried: list[str] = []
    start = _Start([], [])
    if release:
        if held and not mine:
            if not force:
                raise model.PlanningError(f"that step is held by {held}, not by you")
            carried.append("checklist_claim")
        step["claimed_by"] = ""
        action = "checklist_released"
    elif held and not mine:
        if not force:
            raise model.PlanningError(
                f"that step is already held by {held}; pass force to take it over"
            )
        carried.append("checklist_claim")
        step["claimed_by"] = label
        action = "checklist_taken_over"
    else:
        step["claimed_by"] = label
        action = "checklist_claimed"
    if not release:
        current = read_model.state_by_id(conn, str(row["state_id"]))
        if current["category"] in states.STARTABLE:
            start = _starting(conn, row)
    else:
        _keep_held(conn, row, str(row["claim_ref"]), steps)
    _write(conn, row, ["checklist = ?", *start.updates], [model.dumps(steps), *start.parameters])
    identity = str(row["work_item_id"])
    _log(conn, identity, action, step["text"][:120], author)
    _started(conn, identity, start, author, "claimed")
    if not release:
        waiting.deliver(conn, row)
    overridden = _record_overrides(conn, identity, carried, author)
    requeued = _settle(conn, identity, author, "released") if release else None
    answer = read_model.present(conn, read_model.item_by_id(conn, identity), full=True)
    _say_started(conn, answer, start)
    if requeued is not None:
        answer["requeued"] = requeued
    if overridden:
        answer["overridden"] = overridden
    return answer


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
    row = _row_for_write(conn, reference, expected_revision)
    steps = model.checklist(row["checklist"])
    step = _step(steps, item_id, conn, row)
    label = calls.holder(author)
    theirs = bool(step["claimed_by"]) and step["claimed_by"] not in (label, model.actor(author))
    if theirs and not force:
        raise model.PlanningError(
            f"that step is claimed by {step['claimed_by']}; pass force to complete it anyway"
        )
    step["done"] = bool(done)
    step["done_by"] = label if done else ""
    step["claimed_by"] = "" if done else step["claimed_by"]
    # A tick, even of a step already ticked, is the caller standing behind it;
    # reopening leaves nothing to confirm.
    step[model.PREVIOUS_HOLDER] = False
    _keep_held(conn, row, str(row["claim_ref"]), steps)
    _write(conn, row, ["checklist = ?"], [model.dumps(steps)])
    identity = str(row["work_item_id"])
    _log(
        conn,
        identity,
        "checklist_completed" if done else "checklist_reopened",
        step["text"][:120],
        author,
    )
    overridden = _record_overrides(conn, identity, ["checklist_claim"] if theirs else [], author)
    # A tick ends the step's claim, which may have been the last holder of the task.
    requeued = _settle(conn, identity, author, "step completed") if done else None
    answer = read_model.present(conn, read_model.item_by_id(conn, identity), full=True)
    if requeued is not None:
        answer["requeued"] = requeued
    if overridden:
        answer["overridden"] = overridden
    return answer


def link_work_items(
    conn: sqlite3.Connection,
    source: str,
    target: str,
    kind: str,
    *,
    remove: bool = False,
    author: str | None = None,
) -> dict:
    """Add or remove one link, writing history on both ends only when it changed.

    A `relates-to` link is one record whichever end wrote it, so it is found and
    removed from either end; the directed kinds are only the record written.
    A link already there, or a removed one already gone, changes nothing and
    says nothing.
    """

    from_row = read_model.item_row(conn, source)
    to_row = read_model.item_row(conn, target)
    from_id, to_id = str(from_row["work_item_id"]), str(to_row["work_item_id"])
    if from_id == to_id:
        raise model.PlanningError("a work item cannot be linked to itself")
    link = model.link_kind(kind)
    stored = _stored_link(conn, from_id, to_id, link)
    if remove:
        changed = stored is not None
        if changed:
            conn.execute("DELETE FROM work_item_links WHERE id = ?", (stored,))
        action = "unlinked"
    else:
        # OR IGNORE: a link another writer stored since the lookup, in either
        # direction for a symmetric kind, is refused by the store's unique index.
        changed = (
            stored is None
            and conn.execute(
                "INSERT OR IGNORE INTO work_item_links(from_id,to_id,kind) VALUES(?,?,?)",
                (from_id, to_id, link),
            ).rowcount
            == 1
        )
        action = "linked"
    if changed:
        _log(conn, from_id, action, f"{link} {read_model.reference(conn, to_row)}", author)
        _log(
            conn,
            to_id,
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
    ids, ticks and step claims, the discussion threads whole, the questions with
    their replies, a list with the comment it stands under, the refs, the
    links in their own direction, and the projects, a project more than one of
    them names keeping its strongest source — and each
    merged item is linked `duplicates` to it, given a summary naming it,
    released and closed in its cancelled state. What describes the merged item
    itself stays with it: its history, its reports with their threads, its
    description, its parent, a ref the survivor already has, and the links
    that would now tie the survivor to itself.

    Each write is one a single tool makes, with that tool's event, so a build
    that knows nothing of merging reads the result as links, checklists
    replaced, a comment, a summary and a transition. All of it happens or none
    of it does; what a caller can correct is refused before the first write.
    `force` carries through a claim another session holds and a guard that
    refuses the close, and each is recorded as `overridden`.
    """

    survivor = _row_for_write(conn, reference, expected_revision)
    merged = _merged_rows(conn, survivor, items)
    overridden = _merge_claims(conn, [survivor, *merged], author, force)
    spoke = _merge_spoke(conn, merged, force)
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
    conn.execute("SAVEPOINT planning_merge")
    try:
        answer = _fold(
            conn,
            survivor,
            steps,
            list(zip(merged, moving, closing, strict=True)),
            overridden=overridden,
            spoke=spoke,
            note=note,
            force=force,
            author=author,
        )
    except BaseException:
        conn.execute("ROLLBACK TO planning_merge")
        conn.execute("RELEASE planning_merge")
        raise
    conn.execute("RELEASE planning_merge")
    words.bring_current(conn)
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
        if (row["kind"] == model.CONTAINER_KIND) != (survivor["kind"] == model.CONTAINER_KIND):
            raise model.PlanningError(
                f"{found} and {survivor_ref} are not of one sort: tasks merge with tasks and"
                " goals or stages with goals or stages"
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
    an item someone else holds ends it, so either needs `force`. An abandoned
    lease (`leases.abandoned`) is nobody's work any more and does not stand in the way.
    """

    actor = model.actor(author)
    caller = calls.current()
    overridden: dict[str, str] = {}
    for row in rows:
        lease = leases.lease(conn, row)
        if lease is None or leases.abandoned(lease) or leases.held_by(lease, caller, actor):
            continue
        if not force:
            raise model.PlanningError(
                f"{read_model.reference(conn, row)} is held by {lease.holder};"
                " pass force to merge it anyway"
            )
        overridden[str(row["work_item_id"])] = lease.holder
    return overridden


def _merge_spoke(conn: sqlite3.Connection, merged: list[sqlite3.Row], force: bool) -> set[str]:
    """The merged items a person acted on that no agent has been told of, by item id.

    Judged before anything moves. Each merged item closes, and the close guard
    would judge it too, but only after its comments have moved to the survivor,
    where they can sit behind that item's own boundary and reach nobody. So the
    refusal comes first, naming what was said; with `force` each such item is
    recorded as overridden once, however much of it the close still sees.
    """

    spoke: set[str] = set()
    for row in merged:
        message = transitions.person_spoke(conn, row, read_model.reference(conn, row))
        if not message:
            continue
        if not force:
            raise model.WorkflowGuardError(f"[person_spoke] {message}")
        spoke.add(str(row["work_item_id"]))
    return spoke


def _fold(
    conn: sqlite3.Connection,
    survivor: sqlite3.Row,
    steps: list[dict],
    merging: list[tuple[sqlite3.Row, list[dict], sqlite3.Row]],
    *,
    overridden: dict[str, str],
    spoke: set[str],
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
    survivor_state = read_model.state_by_id(conn, str(survivor["state_id"]))
    if survivor_state["category"] not in model.HELD_CATEGORIES:
        # Nobody holds a step of work that is not under way: a claim the survivor
        # cannot hold ends on the item it came from.
        for row, found, _target in merging:
            for step in found:
                if step["claimed_by"]:
                    released = str(row["work_item_id"])
                    _log(conn, released, "checklist_released", step["text"][:120], author)
                    step["claimed_by"] = ""
    carried = [step for _row, found, _target in merging for step in found]
    if carried:
        set_checklist(conn, survivor_id, [*steps, *carried], force=True, author=author)
    report: list[dict] = []
    warnings: list[str] = []
    forced: list[str] = []
    if survivor_id in overridden:
        _record_overrides(conn, survivor_id, ["claim"], author)
        forced.append(f"{survivor_ref}: claim")
    for row, found, target in merging:
        identity = str(row["work_item_id"])
        reference = read_model.reference(conn, row)
        # Only a question to the owner is said to wait on the survivor: a list waits for
        # nobody, and a request asked of an agent session waits for that session.
        pending = conn.execute(
            _OWNER_QUESTIONS_ON,
            (identity,),
        ).fetchone()[0]
        roots = _moving_roots(conn, identity)
        # The question was about the work, and the work moves. Left here a pending
        # one would end with this item, and its answer would stay on a closed one.
        # A request asked of an agent session is about the work too, and moves with it.
        # A list goes with the comment it stands under, so a report's stays here.
        conn.execute(
            "UPDATE work_item_requests SET work_item_id = ? WHERE work_item_id = ?"
            " AND (comment_id IS NULL OR comment_id IN (SELECT value FROM json_each(?)))",
            (survivor_id, identity, json.dumps(roots)),
        )
        moved = {
            "steps": len(found),
            "comments": _move_threads(conn, identity, survivor_id, roots),
            "refs": conn.execute(
                "UPDATE OR IGNORE work_item_refs SET work_item_id = ? WHERE work_item_id = ?",
                (survivor_id, identity),
            ).rowcount,
            "links": _repoint_links(conn, identity, survivor_id, involved, author),
            # A project both name keeps the stronger source (`item_projects.carry`).
            "projects": item_projects.carry(conn, identity, survivor_id),
        }
        # The person's pin follows the work. A survivor pinned already keeps its own
        # pin, from when it was pinned, and the merged item is left with none.
        conn.execute(
            "UPDATE OR IGNORE pinned_work_items SET work_item_id = ? WHERE work_item_id = ?",
            (survivor_id, identity),
        )
        conn.execute("DELETE FROM pinned_work_items WHERE work_item_id = ?", (identity,))
        # So does whoever follows it: a session that subscribed hears the survivor.
        subscriptions.carry(conn, identity, survivor_id)
        # The pictures its threads show move with them; the merged item keeps its own.
        images.carry(conn, identity, survivor_id)
        if found:
            # Its steps moved with their claims: a move, not a discard to be recorded.
            _write_checklist(conn, _row_for_write(conn, identity, None), [], [], author)
        link_work_items(conn, identity, survivor_id, "duplicates", author=author)
        current = read_model.item_by_id(conn, identity)
        if current["claim_ref"]:
            _hold(conn, current, "")
            _log(conn, identity, "released", str(current["claim_ref"]), author)
        if identity in overridden:
            _record_overrides(conn, identity, ["claim"], author)
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
        guards = closed.get("overridden", [])
        forced.extend(f"{reference}: {guard}" for guard in guards)
        if identity in spoke and "person_spoke" not in guards:
            _record_overrides(conn, identity, ["person_spoke"], author)
            forced.append(f"{reference}: person_spoke")
        parent = row["parent_id"]
        if parent and parent not in (survivor["parent_id"], survivor_id):
            warnings.append(
                f"{reference} stays under"
                f" {read_model.reference(conn, read_model.item_by_id(conn, str(parent)))};"
                f" {survivor_ref} keeps its own parent"
            )
        if pending:
            warnings.append(
                f"{reference}'s {pending} pending request(s) now wait on {survivor_ref}"
            )
        report.append(
            {
                "reference": reference,
                "work_item_id": identity,
                # A merge closes in a cancelled state, which always has a key to show.
                "state": (states.public_state(target) or {}).get("key"),
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


def _moving_roots(conn: sqlite3.Connection, identity: str) -> list[int]:
    """The roots of a merged item's comment threads, which move; a report's stays."""

    return [
        int(found[0])
        for found in conn.execute(
            "SELECT id FROM work_item_comments WHERE work_item_id = ? AND report = ''"
            " AND reply_to IS NULL AND reply_to_request IS NULL",
            (identity,),
        )
    ]


def _move_threads(
    conn: sqlite3.Connection, identity: str, survivor_id: str, roots: list[int]
) -> int:
    """Move a merged item's discussion threads whole, and say how many rows moved.

    A comment's thread goes with its replies; a report's thread stays, report
    and replies, because the report describes the merged item. Replies to the
    questions that moved before this go too, and the replies to a list stay with
    the report it stands under. One statement, so no reply is ever on another item
    than its root, and the roots are chosen before it runs rather than by a
    subquery over the rows it changes.
    """

    listed = json.dumps(roots)
    return int(
        conn.execute(
            "UPDATE work_item_comments SET work_item_id = ? WHERE work_item_id = ?"
            " AND (id IN (SELECT value FROM json_each(?))"
            " OR reply_to IN (SELECT value FROM json_each(?))"
            " OR reply_to_request IN"
            " (SELECT request_id FROM work_item_requests WHERE work_item_id = ?))",
            (survivor_id, identity, listed, listed, survivor_id),
        ).rowcount
    )


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
        # A link the survivor already has is left as it is, with no event.
        link_work_items(conn, source, target, kind, author=author)
        moved += 1
    return moved


def _stored_link(conn: sqlite3.Connection, source: str, target: str, kind: str) -> int | None:
    """The id of the record that holds this link, or None when there is none.

    A symmetric kind is one record whichever end wrote it, so it is looked for in
    both directions; a directed kind only as written.
    """

    if kind in model.SYMMETRIC_LINK_KINDS:
        row = conn.execute(
            "SELECT id FROM work_item_links WHERE kind = ?"
            " AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))",
            (kind, source, target, target, source),
        ).fetchone()
    else:
        row = conn.execute(
            "SELECT id FROM work_item_links WHERE from_id = ? AND to_id = ? AND kind = ?",
            (source, target, kind),
        ).fetchone()
    return None if row is None else int(row[0])


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
    reply_to: int | None = None,
    reply_to_request: str | None = None,
    awaits_reply: bool = False,
) -> dict:
    """A comment: the root of a thread, or a reply under one when it names a parent.

    A reply answers a comment (`reply_to`) or a question (`reply_to_request`) of
    the same item. Threads are one level deep, so a reply to a reply stands under
    that reply's root, and the answer names the root it joined. `awaits_reply`
    says the writer waits for an answer in that thread; a read says whether one came.
    """

    if not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")
    row = read_model.item_row(conn, reference)
    parent = _thread_parent(conn, row, reply_to, reply_to_request)
    if parent is not None and checklist_item_id is not None:
        raise model.PlanningError("a reply carries no checklist step; its root does")
    step = (
        _step(model.checklist(row["checklist"]), checklist_item_id, conn, row)
        if checklist_item_id is not None
        else None
    )
    root, question = parent if parent is not None else (None, None)
    inserted = conn.execute(
        "INSERT INTO work_item_comments(work_item_id,author,body,checklist_item_id,"
        "checklist_item_text,call_id,reply_to,reply_to_request,awaits_reply)"
        " VALUES(?,?,?,?,?,?,?,?,?)",
        (
            str(row["work_item_id"]),
            model.actor(author),
            model.multiline_field(body, "comment.body", limit=8000),
            step["id"] if step else None,
            step["text"] if step else None,
            calls.call_id(conn, str(row["work_item_id"])),
            root,
            question,
            int(awaits_reply),
        ),
    )
    words.bring_current(conn)
    # Both parents always: the root a reply joined, and null for a new root.
    return {
        "work_item": read_model.reference(conn, row),
        "comment_count": read_model.comment_count(conn, row),
        "comment_id": inserted.lastrowid,
        "reply_to": root,
        "reply_to_request": question,
    }


def _thread_parent(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    reply_to: int | None,
    reply_to_request: str | None,
) -> tuple[int | None, str | None] | None:
    """The root a reply stands under, as (comment, question); None for a new root.

    Refused here, before the store's trigger would, so the caller reads which
    parent was wrong rather than a constraint.
    """

    if reply_to is None and reply_to_request is None:
        return None
    if reply_to is not None and reply_to_request is not None:
        raise model.PlanningError("reply_to and reply_to_request exclude each other")
    identity = str(row["work_item_id"])
    if reply_to_request is not None:
        question = model.text_field(reply_to_request, "reply_to_request", limit=64)
        found = conn.execute(
            "SELECT 1 FROM work_item_requests WHERE request_id = ? AND work_item_id = ?",
            (question, identity),
        ).fetchone()
        if found is None:
            raise model.PlanningError(
                f"question {question} is not on {read_model.reference(conn, row)}"
            )
        return None, question
    if not isinstance(reply_to, int) or isinstance(reply_to, bool) or reply_to < 1:
        raise model.PlanningError("reply_to must be a positive integer")
    parent = conn.execute(
        "SELECT reply_to, reply_to_request FROM work_item_comments"
        " WHERE id = ? AND work_item_id = ?",
        (reply_to, identity),
    ).fetchone()
    if parent is None:
        raise model.PlanningError(f"comment {reply_to} is not on {read_model.reference(conn, row)}")
    # One level deep: a reply to a reply joins the root that reply stands under.
    if parent["reply_to_request"] is not None:
        return None, str(parent["reply_to_request"])
    return int(parent["reply_to"] or reply_to), None


#: The longest decision a resolved mark carries: a short label, the reasoning is the thread.
MAX_RESOLUTION = 280


def resolve_comment(
    conn: sqlite3.Connection,
    reference: str,
    comment_id: int,
    *,
    resolution: str | None = None,
    reopen: bool = False,
    author: str | None = None,
) -> dict:
    """Mark a thread's root resolved with a one-line decision, or remove the mark.

    The mark is no field of the item: no revision guards it or records it, and the
    history says who set and removed it. Marking again replaces the decision and
    counts as a new mark; reopening a root that has none writes nothing.
    """

    if not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")
    row = read_model.item_row(conn, reference)
    identity = str(row["work_item_id"])
    decision = _decision(resolution, reopen)
    root = _resolvable_root(conn, row, comment_id)
    # First, so that a reopen writing nothing is still a call on this item: the
    # answer names the item by reference, which `calls.acted_on` cannot read.
    call = calls.call_id(conn, identity)
    if not reopen:
        conn.execute(
            "UPDATE work_item_comments SET resolved_at = ?, resolved_by = ?, resolution = ?,"
            " resolved_call_id = ? WHERE id = ?",
            (request_model.now(), model.actor(author), decision, call, comment_id),
        )
        detail = f"{comment_id}: {decision}" if decision else str(comment_id)
        _log(conn, identity, "comment_resolved", detail, author)
    elif root["resolved_at"] is not None:
        conn.execute(
            "UPDATE work_item_comments SET resolved_at = NULL, resolved_by = '', resolution = '',"
            " resolved_call_id = NULL WHERE id = ?",
            (comment_id,),
        )
        _log(conn, identity, "comment_reopened", str(comment_id), author)
    words.bring_current(conn)
    return {
        "work_item": read_model.reference(conn, row),
        "comment_id": comment_id,
        "resolution": read_model.comment(conn, comment_id)["resolution"],
    }


def _decision(resolution: str | None, reopen: bool) -> str:
    """The decision a mark records: one line, and blank when the thread itself says it."""

    if reopen:
        if resolution is not None:
            raise model.PlanningError("resolution and reopen exclude each other")
        return ""
    text = model.text_field(
        "" if resolution is None else resolution,
        "resolution",
        limit=MAX_RESOLUTION,
        required=False,
    )
    # `text_field` lets a line break through; a mark is read on one line.
    if "\n" in text:
        raise model.PlanningError("resolution must be one line")
    return text


def _resolvable_root(conn: sqlite3.Connection, row: sqlite3.Row, comment_id: int) -> sqlite3.Row:
    """The root a mark goes on, refused here before the store's trigger would."""

    if not isinstance(comment_id, int) or isinstance(comment_id, bool) or comment_id < 1:
        raise model.PlanningError("comment_id must be a positive integer")
    found = conn.execute(
        "SELECT work_item_id, reply_to, reply_to_request, resolved_at"
        " FROM work_item_comments WHERE id = ?",
        (comment_id,),
    ).fetchone()
    if found is None:
        raise model.WorkItemNotFoundError(f"no comment {comment_id}")
    if found["work_item_id"] != row["work_item_id"]:
        raise model.PlanningError(
            f"comment {comment_id} is not on {read_model.reference(conn, row)}"
        )
    if found["reply_to_request"] is not None:
        raise model.PlanningError(
            f"comment {comment_id} answers question {found['reply_to_request']};"
            " a question has its own status and no mark"
        )
    if found["reply_to"] is not None:
        raise model.PlanningError(
            f"comment {comment_id} is a reply; mark its root, comment {found['reply_to']}"
        )
    return found


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
    row = _row_for_write(conn, reference, expected_revision)
    if make_current and require_revision and expected_revision is None:
        raise model.PlanningError("expected_revision is required when making a report current")
    record = model.summary(payload)
    identity = str(row["work_item_id"])
    # Keep the report and the guarded current-outcome write indivisible even
    # when a caller catches a refusal and commits its surrounding transaction.
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
    words.bring_current(conn)
    return read_model.present(conn, read_model.item_by_id(conn, identity), full=True)


def select_summary(
    conn: sqlite3.Connection,
    reference: str,
    comment_id: int,
    *,
    expected_revision: int | None = None,
    author: str | None = None,
) -> dict:
    row = _row_for_write(conn, reference, expected_revision)
    if expected_revision is None:
        raise model.PlanningError("expected_revision is required when selecting a report")
    if not isinstance(comment_id, int) or isinstance(comment_id, bool) or comment_id < 1:
        raise model.PlanningError("comment_id must be a positive integer")
    report = conn.execute(
        "SELECT report FROM work_item_comments WHERE id=? AND work_item_id=? AND report != ''",
        (comment_id, row["work_item_id"]),
    ).fetchone()
    if report is None:
        raise model.PlanningError("that comment is not a report belonging to this work item")
    conn.execute("SAVEPOINT planning_summary")
    try:
        _write(conn, row, ["summary = ?", "summary_comment_id = ?"], [report["report"], comment_id])
        _log(conn, str(row["work_item_id"]), "summarized", "", author)
    except BaseException:
        conn.execute("ROLLBACK TO planning_summary")
        conn.execute("RELEASE planning_summary")
        raise
    conn.execute("RELEASE planning_summary")
    words.bring_current(conn)
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


def space_identity(conn: sqlite3.Connection, reference: object) -> str:
    """The id of the space a caller named by its id, key or name.

    It reads nothing but the space's identity, so a store another build wrote,
    whose spaces lack a column the record reads, still answers it.
    """

    return str(_space_row(conn, reference)["planning_space_id"])


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
    """The workflow as a caller reads it: its states and moves, without the service state."""

    rows = states.public_states(conn, str(workflow["workflow_id"]))
    listed = {str(state["state_id"]) for state in rows}
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
            if source in listed and target in listed
        ],
    }


def _row_for_write(
    conn: sqlite3.Connection, reference: object, expected: int | None
) -> sqlite3.Row:
    """The item a write decides from, read under the lock it will be written with.

    Every verb a caller names an item to, and that writes it through `_write`,
    starts here. Read first and locked second, a verb was refused for any write
    that landed in between, including from a caller that named no revision at
    all: four agents reporting on one item got `revision 30, not 0`, and a merge
    wrote back the survivor's checklist as it was before somebody else added a
    step. Taken first, the lock leaves nothing to land in between, so the
    revision is compared only when the caller named one, and then against what
    the item holds now. A delete starts here too: it decides from the item's
    children.

    A caller already inside a transaction keeps it: an immediate one holds the
    lock already, and a deferred one is still refused by `_write` rather than
    written over.
    """

    if not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")
    row = read_model.item_row(conn, reference)
    _require_revision(row, expected)
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
    `_row_for_write` reads it under the write lock, so another connection cannot
    commit in between; naming the revision in the WHERE clause is what still
    makes the write mean "and nothing changed since I looked" wherever that lock
    is not held — a row read outside it, or by the take-next queue, which picks
    before it locks. Two agents both saw an unheld item and both wrote their own
    name into it before this clause existed: one UPDATE matches, the other
    matches nothing and is refused here instead of landing on top of a claim.

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


def _hold(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    holder: str,
    updates: list[str] | None = None,
    parameters: list[object] | None = None,
) -> None:
    """Set who holds an item, and the call that took it, in one guarded write.

    `updates` and their `parameters` are what a claim writes in the same statement:
    the state it starts the item in, with its basis and its start (`_starting`).

    The only writer of `claim_ref` but one: a transition into a terminal state
    clears both columns in its own write. The holder and the call travel together, so
    a lease always names the call that took it; a release clears both. A build
    that writes `claim_ref` alone leaves the call unchanged, and the store's
    `work_items_claim_follows_call` trigger clears it, which makes that claim
    read as unconfirmed rather than as somebody else's lease.
    """

    taken = calls.call_id(conn, str(row["work_item_id"])) if holder else None
    _write(
        conn,
        row,
        ["claim_ref = ?", "claim_call_id = ?", *(updates or [])],
        [holder, taken, *(parameters or [])],
    )


def _log(
    conn: sqlite3.Connection,
    work_item_id: str,
    action: str,
    detail: str,
    author: str | None,
    *,
    limit: int = EVENT_DETAIL_LIMIT,
) -> None:
    """Write one history event; `limit` is raised only for a detail this module composes."""

    conn.execute(
        "INSERT INTO work_item_events(work_item_id,action,detail,author,call_id) VALUES(?,?,?,?,?)",
        (
            work_item_id,
            model.event_action(action),
            model.text_field(detail, "event.detail", limit=limit, required=False),
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
