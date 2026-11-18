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
import functools
import json
import sqlite3
from collections.abc import Callable, Iterator, Mapping, Sequence
from typing import TypeVar, cast

from . import agents as planning_agents
from . import (
    calls,
    closing,
    decisions,
    deferral,
    images,
    item_projects,
    item_tree,
    leases,
    model,
    participation,
    pending,
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


_Write = TypeVar("_Write", bound=Callable[..., dict])


def _marked(write: _Write) -> _Write:
    """A write of the service inside its own marks: its answer names what came to wait."""

    @functools.wraps(write)
    def run(conn: sqlite3.Connection, *args: object, **kwargs: object) -> dict:
        with marking(conn) as entered:
            answer = write(conn, *args, **kwargs)
        if entered:
            answer[closing.AWAITING] = entered
        return answer

    return cast(_Write, run)


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
    settings = participation.load(conn)
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
            settings=settings,
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
            settings = participation.load(conn)
            return [_word_hit(conn, row, found, tree, projects, settings) for row in rows]
    return _phrase_search(conn, text, space_id=space_id, limit=limit, offset=offset)


def _word_hit(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    found: list[str],
    tree: item_tree.Tree,
    projects: Mapping[str, list[dict]],
    settings: participation.Settings,
) -> dict:
    """One item a word search found, with the lines that say why (`words.hits`)."""

    return {
        **read_model.present(conn, row, tree=tree, projects=projects, settings=settings),
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
    settings = participation.load(conn)
    for row in rows:
        item = read_model.present(conn, row, tree=tree, projects=projects, settings=settings)
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
    conn: sqlite3.Connection, space_id: str, parent: str | None, item: sqlite3.Row | None = None
) -> sqlite3.Row | None:
    """The row a work item may take as its parent, or None when it takes none.

    Creating and reparenting answer to the same rules, so both call this. The
    parent exists, lives in the same space, is a goal or stage, is open, and is
    neither the item nor anything under it. The last is read by climbing from the
    parent to its root (`item_tree.above`), inside the write lock the caller took,
    so two crossing moves cannot both pass it. `item` is given only when an
    existing item is reparented: a new item cannot yet name itself or have children,
    nor be accepted on its own. An accepted open item does not move under a goal or
    stage that, or one over which, stands in triage or deferred: the owner's decision
    about the work would sit under one not yet taken. The tree has no depth limit.
    """

    if not parent:
        return None
    parent_row = read_model.item_row(conn, parent)
    if str(parent_row["planning_space_id"]) != space_id:
        raise model.PlanningError("a parent work item lives in another planning space")
    if parent_row["kind"] != model.CONTAINER_KIND:
        # The word a conversion of that task passes with: its place says which it becomes.
        raise model.PlanningError(
            f"{read_model.reference(conn, parent_row)} is a task and holds no children:"
            f" convert it first, with convert {{to: {_container_word(parent_row)}}} in"
            " apply_work_item_changes"
        )
    # Work filed under finished work would read as done before it began.
    if read_model.state_by_id(conn, str(parent_row["state_id"]))["is_terminal"]:
        raise model.PlanningError(
            f"{read_model.reference(conn, parent_row)} is closed; reopen it first"
        )
    if item is None:
        return parent_row
    chain = item_tree.above(conn, str(parent_row["work_item_id"]))
    if any(identity == str(item["work_item_id"]) for identity, _kind, _category in chain):
        raise model.PlanningError(
            f"{read_model.reference(conn, parent_row)} stands under this item, or is it:"
            " a parent there would close a cycle"
        )
    category = read_model.state_by_id(conn, str(item["state_id"]))["category"]
    accepted_open = item["acceptance"] is not None and category not in (
        *model.UNACCEPTED_CATEGORIES,
        *model.TERMINAL_CATEGORIES,
    )
    if accepted_open and any(
        found in model.UNACCEPTED_CATEGORIES for _identity, _kind, found in chain
    ):
        raise model.PlanningError(
            "[parent] an accepted item does not move under a goal or stage that is not"
            " accepted: accept it first, or move the item out"
        )
    return parent_row


@_marked
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
    claimed: bool = False,
) -> dict:
    """A new item, placed where the work model puts it, accepted when it is accepted work.

    Without `state`, work filed inside a chain of accepted goals and stages is
    accepted with it, `inherited`, and so is work the owner files, as the owner's;
    an agent's stays in triage unless it names `acceptance`. A goal an agent files
    with no parent and no `acceptance` is the owner's to decide on, by the setting
    of its space (`proposed_goal`): left to the agent, it is accepted at once on the
    basis `agent`; kept for the owner, it lies in triage and the answer's
    `waits_for_owner` names the question about it. A task an agent files under such a
    chain meets the setting `task_in_goal` the same way: left to the agent it is
    `inherited`; kept for the owner it lies under its goal in triage, whatever state it
    named, and the question `task` asks about it. A task that would lie in triage
    under no accepted chain is accepted on `label_rule` when one of its labels has the
    rule `ready` in its space (`_ruling_label`). Each acceptance an agent makes alone,
    `agent`, `assignment`, a task in a goal or a label it chose, is marked in the
    summary of decisions.
    Accepted work stands in ready, and a goal or stage accepted at once stands in
    the service state: `created` names no state for it, and `accepted` and `opened`
    follow. A named
    state is held to the refusals a move there meets (`transitions.placement`),
    and review, blocked and the closed states are refused (`new_item`): the move
    there carries what entering asks for. An active state needs an executor, and
    `claimed` says the write creating the item claims it before it ends, which is
    the executor; without it the active state is refused (`executor`).
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
    proposed = _proposed_goal(conn, space_id, stored_kind, parent_id, entry)
    if proposed == participation.AGENT:
        entry = model.AGENT_BASIS
    given = _given(conn, parent_id, entry)
    in_goal = _task_in_goal(conn, space_id, stored_kind, given, entry)
    if in_goal == participation.HUMAN:
        # Kept for the owner, it lies under the goal in triage, whatever state it named.
        given, state = None, None
    tagged = model.labels(labels)
    ruled = None
    if given is None and in_goal is None and stored_kind != model.CONTAINER_KIND:
        ruled = _ruling_label(conn, space_id, parent_id, tagged)
        if ruled is not None:
            given = LABEL_RULE
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
    if target["category"] == "active" and not claimed:
        refusals.append(
            ("executor", "the new item has no executor: create it with claim to start it at once")
        )
    transitions.refuse(refusals, False)
    closing.note(conn, parent_id, author)
    starts = stored_kind != model.CONTAINER_KIND and target["category"] in model.STARTING_CATEGORIES
    item_id = _insert_item(
        conn,
        space_id=space_id,
        workflow_id=workflow_id,
        state=target,
        kind=stored_kind,
        parent_id=parent_id,
        priority=model.priority(priority),
        title=model.text_field(title, "work_item.title"),
        basis=basis,
        started=True if starts else None,
        description=model.multiline_field(description, "work_item.description"),
        labels=tagged,
        source=model.text_field(source, "work_item.source", limit=512, required=False),
    )
    item_projects.replace(conn, item_id, changes)
    opened = target["category"] == model.SERVICE_CATEGORY
    # A goal or stage accepted at once names no state: its opening says where it stands.
    _log(conn, item_id, "created", "" if opened else str(target["key"]), author)
    if basis is not None:
        _accepted(
            conn,
            item_id,
            basis,
            author,
            named=named,
            in_goal=in_goal == participation.AGENT,
            ruled=None if basis != LABEL_RULE else ruled,
        )
    if opened:
        _log(conn, item_id, "opened", "", author)
    creator = subscriptions.agent_session(calls.current())
    if stored_kind == model.CONTAINER_KIND and parent_id is None and creator is not None:
        # A goal outlives the subagent that filed it, and its news is for the
        # conversation that leads the work; a stage's come through the goal.
        subscriptions.follow(conn, item_id, creator)
    waits = None
    if proposed == participation.HUMAN and target["category"] == "triage":
        waits = _ask_about_goal(conn, item_id, author, by_agent=True)
    if in_goal == participation.HUMAN and parent_id is not None:
        waits = _ask_about_task(conn, item_id, parent_id, author)
    words.bring_current(conn)
    answer = read_model.present(conn, read_model.item_by_id(conn, item_id), full=True)
    if waits is not None:
        answer["waits_for_owner"] = waits.answer()
    return answer


def _proposed_goal(
    conn: sqlite3.Connection,
    space_id: str,
    kind: str,
    parent_id: str | None,
    entry: str | None,
) -> str | None:
    """Who decides on a goal an agent files with no parent and on no one's word, `agent` or
    `human` by the owner's setting of its space; None for any other new item.

    The owner's own write and an agent's `assignment` are the owner's word, and work
    under a goal or stage has its own point.
    """

    if kind != model.CONTAINER_KIND or parent_id is not None or entry is not None:
        return None
    if not calls.from_agent():
        return None
    return participation.load(conn).mode(space_id, "proposed_goal")


#: The basis a rule of a label gives a task in triage.
LABEL_RULE = "label_rule"


def _task_in_goal(
    conn: sqlite3.Connection, space_id: str, kind: str, given: str | None, entry: str | None
) -> str | None:
    """Who decides on a task an agent files under goals and stages all accepted and open,
    on no one's word, `agent` or `human` by the owner's setting of its space; None for
    any other new item.

    Such a task would be `inherited`. The owner's own write and an agent's
    `assignment` are the owner's word, and a goal or stage filed there adds no work of
    its own: the tasks filed under it are asked about.
    """

    if kind == model.CONTAINER_KIND or given != "inherited" or entry is not None:
        return None
    if not calls.from_agent():
        return None
    return participation.load(conn).mode(space_id, "task_in_goal")


def _ruling_label(
    conn: sqlite3.Connection, space_id: str, parent_id: str | None, labels: Sequence[str]
) -> str | None:
    """The label whose rule accepts a task lying in triage under no accepted chain, or None.

    The first of `labels` whose rule in force in the space makes a finding ready. A
    task under a goal or stage whose group of findings waits on the owner's question
    (`triage`) is decided by that answer, so no rule takes it.
    """

    if not labels:
        return None
    ruled = participation.load(conn).ready_label(space_id, labels)
    if ruled is None or _grouped(conn, parent_id):
        return None
    return ruled


def _grouped(conn: sqlite3.Connection, parent_id: str | None) -> bool:
    """Whether a goal or stage over a task in triage, from `parent_id` up, waits on the
    owner's question about its group of findings: the question whether to do the task
    that `questions.acceptance_asked` names, asked as a group's (`triage`)."""

    under = {"work_item_id": None, "parent_id": parent_id, "acceptance": None}
    return questions.acceptance_asked(conn, under, purposes=("triage",)) is not None


def _accepted_detail(basis: str, ruled: str | None) -> str:
    """The detail of an `accepted` event: the basis, and the label a rule accepted by."""

    return basis if ruled is None else f"{basis}: {ruled}"


#: The point of the summary of decisions an agent's acceptance is marked with, by the
#: basis it gives or, under goals and stages all accepted, by the basis it names.
_ACCEPTANCE_POINTS = {
    model.AGENT_BASIS: "proposed_goal",
    model.NAMED_BASIS: "assignment",
    LABEL_RULE: "finding",
}


def _accepted(
    conn: sqlite3.Connection,
    identity: str,
    basis: str,
    author: str | None,
    *,
    named: str | None = None,
    in_goal: bool = False,
    ruled: str | None = None,
) -> int:
    """Record that a write accepted the item on `basis`: its `accepted` event, which it
    answers, and the mark of an acceptance an agent makes alone in the summary of decisions.

    The one place a creation, a move and a claim mark one. A task taken on inside goals
    and stages all accepted on no one's word (`in_goal`) is `task_in_goal`. Otherwise the
    basis decides, and under such a chain, where the order of bases gives `inherited`,
    the basis the write names: the agent's word that the owner gave the work is
    `assignment` whatever basis the order gives. `ruled` is the label a rule accepted by.
    """

    accepted = _log(conn, identity, "accepted", _accepted_detail(basis, ruled), author)
    if calls.from_agent():
        said = named if basis == "inherited" else basis
        point = "task_in_goal" if in_goal else _ACCEPTANCE_POINTS.get(said or "")
        if point is not None:
            decisions.mark(conn, accepted, point, _accepted_what(conn, identity, ruled=ruled))
    return accepted


def _accepted_what(conn: sqlite3.Connection, identity: str, *, ruled: str | None = None) -> str:
    """What the summary of decisions says of an acceptance: `accepted MAIN-12`, with the
    goal or stage it stands under (`under MAIN-3`) or the label a rule took it by
    (`by the label docs`)."""

    row = read_model.item_by_id(conn, identity)
    said = f"accepted {read_model.reference(conn, row)}"
    if ruled is not None:
        return f"{said} by the label {ruled}"
    if row["parent_id"] is not None:
        parent = read_model.item_by_id(conn, str(row["parent_id"]))
        said += f" under {read_model.reference(conn, parent)}"
    return said


def _last_event(conn: sqlite3.Connection, identity: str, action: str) -> int:
    """The event of `action`, such as the `accepted` of a move, the item wrote last."""

    return int(
        conn.execute(
            "SELECT MAX(id) FROM work_item_events WHERE work_item_id = ? AND action = ?",
            (identity, action),
        ).fetchone()[0]
    )


def _ask_about_task(
    conn: sqlite3.Connection,
    identity: str,
    goal_id: str,
    author: str | None,
    *,
    moved_from: sqlite3.Row | None = None,
) -> pending.Waiting:
    """Ask the owner whether to take on a task an agent filed under the accepted goal or
    stage `goal_id`, which lies there in triage, or, with `moved_from` the task as it
    stands, one it moves there, which stays where it was; the action waits on the answer
    (`requests.carry_out`)."""

    row = read_model.item_by_id(conn, identity)
    reference = read_model.reference(conn, row)
    goal = read_model.reference(conn, read_model.item_by_id(conn, goal_id))
    if moved_from is None:
        proposal = pending.Proposal(
            "accept", {"parent": goal_id}, f"accepted {reference} under {goal}"
        )
        prompt = f"An agent files the task {reference} in {goal}: {row['title']}."
    else:
        done = "moved" if moved_from["acceptance"] is not None else "accepted"
        proposal = pending.Proposal(
            "parent",
            {"parent": goal_id},
            f"{done} {reference} under {goal}",
            seen={
                "parent": moved_from["parent_id"],
                "accepted": moved_from["acceptance"] is not None,
            },
        )
        prompt = f"An agent moves the task {reference} into {goal}: {row['title']}."
    return pending.ask(
        conn,
        identity,
        "task_in_goal",
        proposal,
        purpose="task",
        prompt=prompt + " Take it on, put it off, leave it out of the goal, or drop it.",
        fields=request_model.fields(request_model.task_fields(moving=moved_from is not None)),
        author=author,
    )


def _ask_about_goal(
    conn: sqlite3.Connection, identity: str, author: str | None, *, by_agent: bool
) -> pending.Waiting:
    """Ask the owner whether to take on a goal lying in triage, which waits on the answer
    (`requests.carry_out`): one an agent proposed, which recommends taking it on, or one
    that came back from being put off, asked by Valkama with no recommendation."""

    row = read_model.item_by_id(conn, identity)
    reference = read_model.reference(conn, row)
    if by_agent:
        prompt = f"An agent proposes the goal {reference}: {row['title']}."
    else:
        prompt = f"The goal {reference} came back from being put off: {row['title']}."
    return pending.ask(
        conn,
        identity,
        "proposed_goal",
        pending.Proposal("accept", {}, _accepted_what(conn, identity)),
        purpose="goal",
        prompt=prompt + " Take it on, put it off, or drop it.",
        fields=request_model.fields(request_model.goal_fields(recommend=by_agent)),
        author=author,
    )


def _insert_item(
    conn: sqlite3.Connection,
    *,
    space_id: str,
    workflow_id: str,
    state: sqlite3.Row,
    kind: str,
    parent_id: str | None,
    priority: str,
    title: str,
    basis: str | None,
    started: str | bool | None,
    description: str = "",
    labels: Sequence[str] = (),
    source: str = "",
    claim: str = "",
    claim_call_id: object = None,
    steps: Sequence[Mapping[str, object]] = (),
) -> str:
    """Insert a new item's row, its values checked by the caller; its id.

    The one INSERT of a work item, which creating, a conversion's leftover and a
    split part each make. `started` is the moment the item started, or True for
    now; `basis` sets `accepted_at` to now with it. Its number is the space's next.
    """

    identity = model.new_id()
    conn.execute(
        "INSERT INTO work_items(work_item_id,planning_space_id,number,workflow_id,state_id,kind,"
        "parent_id,priority,title,description,labels,source,claim_ref,claim_call_id,checklist,"
        "acceptance,accepted_at,started_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,"
        f" CASE WHEN ? IS NULL THEN NULL ELSE {_NOW} END,"
        f" CASE WHEN ? = 1 THEN {_NOW} ELSE ? END)",
        (
            identity,
            space_id,
            store.next_number(conn, space_id),
            workflow_id,
            str(state["state_id"]),
            kind,
            parent_id,
            priority,
            title,
            description,
            model.dumps(list(labels)),
            source,
            claim,
            claim_call_id,
            model.dumps(list(steps)),
            basis,
            basis,
            started is True,
            None if started is True else started,
        ),
    )
    return identity


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


@_marked
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

    A task an agent moves under goals and stages all accepted and open meets the
    owner's setting `task_in_goal`, as one filed there does: left to the agent, the
    move accepts it from triage as `inherited`, marked in the summary of decisions;
    kept for the owner, the task stays where it was, the rest of the edit is made, and
    the answer's `waits_for_owner` names the question `task` about the move. A label
    the edit puts on a task in triage under no accepted chain may accept it on its
    rule (`_accept_by_label`).
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
        parameters.append(_edited_kind(conn, row, kind))
    moved_under: sqlite3.Row | None = None
    kept_from: str | None = None
    in_goal: str | None = None
    if parent is not None:
        if not parent.strip():
            raise model.PlanningError(
                f"[parent] an edit does not clear the parent: take"
                f" {read_model.reference(conn, row)} out of its goal or stage with move_out,"
                " which records why it leaves"
            )
        parent_row = _parent_row(conn, str(row["planning_space_id"]), parent, item=row)
        moved_to = None if parent_row is None else str(parent_row["work_item_id"])
        in_goal = _moved_into_goal(conn, row, moved_to)
        if in_goal == participation.HUMAN:
            # The owner decides on a task moved into accepted work: it stays where it was.
            kept_from = moved_to
        else:
            updates.append("parent_id = ?")
            parameters.append(moved_to)
        if kept_from is None and parent_row is not None and str(row["parent_id"]) != moved_to:
            moved_under = parent_row
            # The container it leaves and the one it joins each derive from it.
            closing.note(conn, row["parent_id"], author)
            closing.note(conn, moved_to, author)
    reprojected = changes is not None and item_projects.differs(
        conn, str(row["work_item_id"]), changes
    )
    edited = ",".join(
        name
        for name in (_edited(row, updates, parameters), "projects" if reprojected else None)
        if name
    )
    identity = str(row["work_item_id"])
    if edited:
        calls.call_id(conn, identity, edited=edited)
    if not updates and not reprojected:
        answer = read_model.present(conn, row, full=True)
        if kept_from is not None:
            answer["waits_for_owner"] = _ask_about_task(
                conn, identity, kept_from, author, moved_from=row
            ).answer()
        return answer
    _write(conn, row, updates, parameters)
    if reprojected and changes is not None:
        item_projects.replace(conn, identity, changes)
    under = None if moved_under is None else read_model.reference(conn, moved_under)
    if moved_under is not None and row["parent_id"] is not None:
        _left(conn, row, f"moved under {under}", author)
    # Any other field's edit is no audited action; the revision and the call row carry it.
    if change is not None:
        _log(conn, identity, "labels_changed", change, author, limit=model.LABELS_DETAIL_LIMIT)
    if moved_under is not None and _accept_moved(conn, row, f"moved under {under}", author):
        if in_goal == participation.AGENT:
            decisions.mark(
                conn,
                _last_event(conn, identity, "accepted"),
                "task_in_goal",
                _accepted_what(conn, identity),
            )
    if labels is not None and change is not None:
        _accept_by_label(
            conn, identity, [label for label in labels if label not in current], author
        )
    waits = None
    if kept_from is not None:
        waits = _ask_about_task(conn, identity, kept_from, author, moved_from=row)
    words.bring_current(conn)
    answer = read_model.present(conn, read_model.item_by_id(conn, identity), full=True)
    if waits is not None:
        answer["waits_for_owner"] = waits.answer()
    return answer


def _moved_into_goal(
    conn: sqlite3.Connection, row: sqlite3.Row, moved_to: str | None
) -> str | None:
    """Who decides on a task an agent moves under goals and stages all accepted and open,
    `agent` or `human` by the owner's setting of its space; None for any other edit.

    Moving work there is filing it there. A task closed or put off is no work joining
    the goal: it comes back, or is reopened, through the owner's own questions.
    """

    if moved_to is None or row["kind"] == model.CONTAINER_KIND or str(row["parent_id"]) == moved_to:
        return None
    if not calls.from_agent() or not item_tree.accepted_chain(conn, moved_to):
        return None
    category = read_model.state_by_id(conn, str(row["state_id"]))["category"]
    if category in (*model.TERMINAL_CATEGORIES, "deferred"):
        return None
    return participation.load(conn).mode(str(row["planning_space_id"]), "task_in_goal")


def _accepted_in_goal(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    current: sqlite3.Row,
    gives: str | None,
    named: str | None,
) -> str | None:
    """Who decides on a task an agent moves out of triage into accepted work under goals
    and stages all accepted and open, on no one's word, `agent` or `human` by the
    owner's setting of its space (`task_in_goal`); None for any other move.

    Such a move accepts it `inherited` (`gives`), as filing it there does. The agent's
    `assignment` is the owner's word and passes; a claim by number meets no gate.
    """

    if gives != "inherited" or named is not None or not calls.from_agent():
        return None
    if row["kind"] == model.CONTAINER_KIND or current["category"] != "triage":
        return None
    return participation.load(conn).mode(str(row["planning_space_id"]), "task_in_goal")


def _accept_by_label(
    conn: sqlite3.Connection, identity: str, added: Sequence[str], author: str | None
) -> None:
    """Accept a task lying in triage under no accepted chain on the rule of a label an
    edit just put on it (`label_rule`), moving it to the first ready state it reaches.

    The rule acts on the write that puts the label on, whoever writes it: switching the
    rule on accepts nothing already lying there. A label an agent chose that a rule
    accepted by is marked in the summary of decisions, as `finding`.
    """

    row = read_model.item_by_id(conn, identity)
    if row["kind"] == model.CONTAINER_KIND or row["acceptance"] is not None:
        return
    if read_model.state_by_id(conn, str(row["state_id"]))["category"] != "triage":
        return
    parent = None if row["parent_id"] is None else str(row["parent_id"])
    if item_tree.accepted_chain(conn, parent):
        return
    ruled = _ruling_label(conn, str(row["planning_space_id"]), parent, added)
    target = None if ruled is None else states.reachable(conn, row, "ready")
    if ruled is None or target is None:
        return
    _transition(conn, identity, str(target["state_id"]), author=author, ruled=ruled)


def _left(conn: sqlite3.Connection, row: sqlite3.Row, reason: str, author: str | None) -> None:
    """Record on the goal or stage `row` stood under that it left, and why: `child_left`.

    The container keeps that it had this child, so what it derives counts the child,
    and its `confirmation` part reads the reason: `MAIN-12: <reason>`.
    """

    detail = f"{read_model.reference(conn, row)}: {reason}"
    _log(conn, str(row["parent_id"]), "child_left", detail, author)


def _accept_moved(
    conn: sqlite3.Connection, row: sqlite3.Row, reason: str, author: str | None
) -> bool:
    """Accept an item in triage that a move put under goals and stages all accepted and
    open; whether it did.

    Moving it there is filing it there: it takes the basis `inherited`, a task moves
    to the first ready state its workflow reaches and a goal or stage to the service
    state, taking the work in triage under it along (`_transition`). An item put off
    stays put off, and one with no ready state to reach stays where it is.
    """

    identity = str(row["work_item_id"])
    current = read_model.state_by_id(conn, str(row["state_id"]))
    if current["category"] != "triage" or not item_tree.accepted_chain(
        conn, str(read_model.item_by_id(conn, identity)["parent_id"])
    ):
        return False
    target = states.reachable(conn, row, "ready")
    if target is None:
        return False
    _transition(conn, identity, str(target["state_id"]), reason=reason, author=author)
    return True


@_marked
def take_out(conn: sqlite3.Connection, reference: str, reason: str, author: str | None) -> dict:
    """Clear an item's parent, recording on the goal or stage it left why it left.

    The one write that clears a parent: an edit refuses `parent: ""`, so the reason
    the work model asks for is never bypassed. `split.move_out` makes it, beside the
    move to triage (`move_to_triage`); the caller has checked that there is a parent.
    """

    row = _row_for_write(conn, reference, None)
    closing.note(conn, row["parent_id"], author)
    calls.call_id(conn, str(row["work_item_id"]), edited="parent_id")
    _write(conn, row, ["parent_id = ?"], [None])
    _left(conn, row, reason, author)
    return read_model.present(
        conn, read_model.item_by_id(conn, str(row["work_item_id"])), full=True
    )


#: The refusal a move out of a goal or stage is spared: an accepted one leaves for triage.
_MOVED_OUT_SPARES = frozenset({"container_state"})


def move_to_triage(
    conn: sqlite3.Connection, reference: str, state: str, *, reason: str, author: str | None
) -> dict:
    """Move an item that leaves its goal or stage to `state`, the triage state chosen for it.

    A move like any other, with its guards, except the one that keeps an accepted goal
    or stage out of triage: moved out, it is new work for the owner to decide on again,
    as a task moved out is. Nothing on a surface reaches this but `split.move_out`.
    """

    return _transition(
        conn, reference, state, reason=reason, author=author, spared=_MOVED_OUT_SPARES
    )


def locked_row(
    conn: sqlite3.Connection, reference: object, expected_revision: int | None = None
) -> sqlite3.Row:
    """The item an action composed above the service decides from, read under the write lock.

    `_row_for_write` for `split`: the writes it then makes through the service find
    the lock already taken, so nothing lands between its decision and them.
    """

    return _row_for_write(conn, reference, expected_revision)


# -- converting -------------------------------------------------------------------


def reform(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    *,
    kind: str,
    state: sqlite3.Row | None,
    reason: str,
    steps: list[dict],
    labels: list[str],
    author: str | None,
) -> dict:
    """Write an item converted to `kind`: one of `split.convert`'s writes, which decides it.

    `state` is where it then stands, or None where it stays: a goal or stage accepted
    stands in the service state, recorded `opened` with `reason`, and a task out of it
    in a ready state, recorded `transitioned`. Its claim ends, and so does every step
    claim it had, which `steps`, the steps it keeps, no longer carry: each recorded
    `released` or `checklist_released`. A goal or stage keeps no start of its own, so
    it loses `started_at`. The goal or stage it stands under, and the item itself,
    derive from it, and are marked. The `converted` event is the caller's
    (`log_converted`), once it knows what the conversion left.
    """

    identity = str(row["work_item_id"])
    # The first write of the call names what it acted on: the converted item.
    calls.call_id(conn, identity)
    closing.note(conn, row["parent_id"], author)
    closing.note(conn, identity, author)
    current = model.labels(json.loads(str(row["labels"])))
    change = model.labels_change(current, labels)
    updates = ["kind = ?", "checklist = ?", "labels = ?"]
    parameters: list[object] = [kind, model.dumps(steps), model.dumps(labels)]
    if state is not None:
        updates.append("state_id = ?")
        parameters.append(str(state["state_id"]))
    held = str(row["claim_ref"])
    if held:
        updates += ["claim_ref = ?", "claim_call_id = ?"]
        parameters += ["", None]
    if kind == model.CONTAINER_KIND:
        updates.append("started_at = NULL")
    _write(conn, row, updates, parameters)
    if held:
        _log(conn, identity, "released", held, author)
    for step in model.checklist(row["checklist"]):
        if step["claimed_by"]:
            _log(conn, identity, "checklist_released", step["text"][:120], author)
    if change is not None:
        _log(conn, identity, "labels_changed", change, author, limit=model.LABELS_DETAIL_LIMIT)
    if state is not None and state["category"] == model.SERVICE_CATEGORY:
        _log(conn, identity, "opened", reason, author)
    elif state is not None:
        _log(conn, identity, "transitioned", f"{state['key']}: {reason}", author)
    return {"released": held} if held else {}


def file_leftover(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    *,
    title: str,
    steps: list[dict],
    state: sqlite3.Row,
    basis: str | None,
    holder: bool,
    reason: str,
    author: str | None,
) -> str:
    """File the work a task converted into a goal or stage leaves, under it; its reference.

    `row` is the task as it stood before the conversion (`reform`): the new task takes
    its kind, priority and start, its holder with the call that took it, so the claim
    reads as the same lease, when `holder`, and its projects (`item_projects.carry`).
    `steps` go with their ids, ticks and claims, each claim recorded
    `checklist_claimed`. It stands in `state` with `basis`; `reason` follows the key
    of its `created`, as a move's does, for one blocked as the task was.
    """

    parent = str(row["work_item_id"])
    closing.note(conn, parent, author)
    claim = str(row["claim_ref"]) if holder else ""
    identity = _insert_item(
        conn,
        space_id=str(row["planning_space_id"]),
        workflow_id=str(row["workflow_id"]),
        state=state,
        kind=str(row["kind"]),
        parent_id=parent,
        priority=str(row["priority"]),
        title=model.text_field(title, "leftover.title"),
        basis=basis,
        started=row["started_at"],
        claim=claim,
        claim_call_id=row["claim_call_id"] if claim else None,
        steps=steps,
    )
    _log(conn, identity, "created", f"{state['key']}: {reason}" if reason else state["key"], author)
    if basis is not None:
        _log(conn, identity, "accepted", basis, author)
    if claim:
        _log(conn, identity, "claimed", "", author)
    for step in steps:
        if step["claimed_by"]:
            _log(conn, identity, "checklist_claimed", step["text"][:120], author)
    item_projects.carry(conn, parent, identity)
    return read_model.reference(conn, read_model.item_by_id(conn, identity))


def log_converted(conn: sqlite3.Connection, identity: str, detail: str, author: str | None) -> None:
    """Record on a converted item what it became and what the conversion left: `converted`."""

    _log(conn, identity, "converted", detail, author)


# -- splitting a part off ----------------------------------------------------------


@dataclasses.dataclass(frozen=True)
class Part:
    """What a part split off a task is filed with, read and checked by `split.split_off`.

    `steps` are the task's steps it takes, with their ids, ticks and marks and no claim;
    `state` and `basis` where it stands and on what; `deferred` the condition it waits
    on, when it stands put off as the task does.
    """

    title: str
    kind: str
    priority: str
    description: str
    labels: list[str]
    source: str
    projects: list[str]
    steps: list[dict]
    state: sqlite3.Row
    basis: str | None
    deferred: deferral.Held | None


def file_part(conn: sqlite3.Connection, row: sqlite3.Row, part: Part, author: str | None) -> str:
    """File a part split off the task `row` beside it, under its parent; its reference.

    One of `split.split_off`'s writes, which decides the part: it stands in
    `part.state` with `part.basis`, names `part.projects`, each `named`, and records
    `split_from` with the task's reference; one put off waits on the task's condition.
    """

    parent_id = None if row["parent_id"] is None else str(row["parent_id"])
    closing.note(conn, parent_id, author)
    identity = _insert_item(
        conn,
        space_id=str(row["planning_space_id"]),
        workflow_id=str(row["workflow_id"]),
        state=part.state,
        kind=part.kind,
        parent_id=parent_id,
        priority=part.priority,
        title=part.title,
        basis=part.basis,
        started=None,
        description=part.description,
        labels=part.labels,
        source=part.source,
        steps=part.steps,
    )
    item_projects.replace(conn, identity, part.projects)
    if part.deferred is not None:
        deferral.restore(conn, identity, part.deferred)
    _log(conn, identity, "created", str(part.state["key"]), author)
    if part.basis is not None:
        _log(conn, identity, "accepted", part.basis, author)
    _log(conn, identity, "split_from", read_model.reference(conn, row), author)
    return read_model.reference(conn, read_model.item_by_id(conn, identity))


def hand_over_steps(
    conn: sqlite3.Connection, row: sqlite3.Row, moved: list[dict], to: str, author: str | None
) -> None:
    """Take the steps `moved` off the task `row`, which a part `to` split off it took.

    Each claim on one ends (`checklist_released`), and the task records `split_off`,
    `MAIN-15: 2 steps`: the steps went with their work, not discarded, so no
    `checklist_removed` is written. A task at work whose last holder was such a step
    goes back to the queue at the end of the write (`_settle`).
    """

    identity = str(row["work_item_id"])
    gone = {str(step["id"]) for step in moved}
    steps = model.checklist(row["checklist"])
    _write(
        conn,
        row,
        ["checklist = ?"],
        [model.dumps([step for step in steps if str(step["id"]) not in gone])],
    )
    for step in steps:
        if str(step["id"]) in gone and step["claimed_by"]:
            _log(conn, identity, "checklist_released", str(step["text"])[:120], author)
    _log(conn, identity, "split_off", f"{to}: {len(moved)} steps", author)
    _settle(conn, identity, author, "steps split off")


def _edited_kind(conn: sqlite3.Connection, row: sqlite3.Row, kind: str) -> str:
    """The stored kind an edit of `kind` leaves, refused where an edit cannot change it.

    An edit changes a task's kind among the task kinds. A task becomes a goal or
    stage, and back, by converting it (`split.convert`), which is an action of its
    own, and the refusal names the word it passes with; whether a container is a goal
    or a stage follows from whether it stands under a parent.
    """

    named = model.public_kind(kind)
    container = row["kind"] == model.CONTAINER_KIND
    if container and named == model.outward_kind(row["kind"], row["parent_id"]):
        return model.CONTAINER_KIND
    reference = read_model.reference(conn, row)
    if container:
        raise model.PlanningError(
            f"an edit does not make a goal or stage a task: {reference} becomes one with"
            " convert {to: task}, and goal or stage follows from the parent"
        )
    if named not in model.TASK_KINDS:
        word = _container_word(row)
        raise model.PlanningError(
            f"an edit changes kind among task, bug and improvement: {reference} becomes a"
            f" {word} with convert {{to: {word}}}"
        )
    return model.work_item_kind(named)


def _container_word(row: sqlite3.Row) -> str:
    """What a task becomes when converted where it stands: a stage under a parent, else a goal."""

    return "stage" if row["parent_id"] else "goal"


def _edited(row: sqlite3.Row, updates: list[str], parameters: list[object]) -> str | None:
    """The fields an edit changes, for its call row; one sent with its own value is not."""

    columns = (update.split(" ", 1)[0] for update in updates)
    changed = [
        column for column, value in zip(columns, parameters, strict=True) if row[column] != value
    ]
    return ",".join(changed) or None


@_marked
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
    # Its parent derives from the children it has; the row of a container awaiting
    # confirmation goes with it.
    closing.note(conn, row["parent_id"])
    # Work put off until it comes back as if it closed, while it can still be named.
    returned = _return_waiting(conn, [identity], deferral.DELETED)
    conn.execute("DELETE FROM work_items WHERE work_item_id = ?", (identity,))
    # The rows went with the item; a file no other item holds goes once this commits.
    images.release(conn, pictures)
    words.bring_current(conn)
    answer = {
        "work_item_id": row["work_item_id"],
        "reference": read_model.reference(conn, row),
        "deleted": True,
    }
    if returned:
        answer["returned"] = returned
    return answer


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
    cancels: object = None,
    following: object = None,
    gated: bool = False,
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

    Cancelling a goal or stage with open work under it cancels that work too, so it is
    refused with the list of what would close until `cancels` names that list's token
    (`closing.cancel_list`, `_cancel_under`); `force` does not carry it. A close names
    the open items it left with nothing open blocking them as `freed`.

    `gated` says the move is the caller's own write, as a surface takes it, which meets
    the owner's setting of the space: an agent's cancel of an item filed outside its
    own work is the owner's to make where `cancel_outside` says `human`, and then it
    is not made but waits for their answer (`_cancel_point`, `waits_for_owner`). A cancel
    of work other live sessions do asks those sessions (`cancel_shared`): with the owner
    where the setting says `human`, alone otherwise, and then it waits for their
    answers (`waits_for_sessions`), even when it follows an owner's answer. So is
    an agent's move of a task in triage into accepted work under goals and stages all
    accepted and open, where `task_in_goal` says `human`: the task stays in triage and
    the question `task` asks about it; left to the agent, the acceptance is marked in
    the summary of decisions, as is an assignment an agent names. An agent's
    completion of a goal awaiting its confirmation is the owner's to make where
    `goal_close` says `human`: the goal stays as it is, with what the call wrote
    before the move, and waits on the question `confirm` of its period of waiting
    (`_ask_about_close`); left to the agent, the close is marked. The
    writes Valkama composes, the cancel an owner's answer carries out among them, are
    not gated. `following` names the owner's answered question, on the item or over
    it, that the cancel follows from: it needs no question of the owner and reads no
    setting.

    While the owner is asked whether to do an item, an agent moves it out of triage or
    deferred only to a cancel (`acceptance_question`); a person's move out is their
    answer, and the question on the item ends withdrawn (`_settled_by_owner`).
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
        cancels=cancels,
        following=following,
        gated=gated,
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
    deferred: deferral.Held | None = None,
    claim: PriorClaim | None = None,
) -> dict:
    """Put a task a failed launch started back in the state the launch found it in.

    The launch's claim moved the task to work and the client never started, so
    nothing happened that the move could stand for. Going back is forced, as the
    compensation always was, and it is the one write that may enter deferred: the
    task is not being deferred, only put back where it stood, with `deferred`, the
    condition it stood there on (`deferral_of`, read before the launch's claim took
    it away). The move ends the launch's claim like any move out of work, and a move
    back to triage or deferred takes away the basis the claim gave. Nothing on a
    surface reaches this: a create, a move and `force` keep refusing entry into
    deferred.

    `claim` is the claim the launch took over (`claim_of`), put back with the call
    that took it, so its lease reads as it did: a confirmed claim comes back
    confirmed, by its session, and an unconfirmed one unconfirmed. It is recorded as
    its holder taking the item back over from the launch, forced, as a claim that
    puts it back always was; it names its own call and makes none.
    """

    answer = _transition(
        conn,
        reference,
        state,
        reason="launch_failed",
        force=True,
        expected_revision=expected_revision,
        author=author,
        spared=_PUT_BACK_SPARES,
    )
    identity = str(answer["work_item_id"])
    row = read_model.item_by_id(conn, identity)
    category = read_model.state_by_id(conn, str(row["state_id"]))["category"]
    if deferred is not None and category == "deferred":
        deferral.restore(conn, identity, deferred)
    if claim is not None:
        row = read_model.item_by_id(conn, identity)
        held = str(row["claim_ref"])
        _write(conn, row, ["claim_ref = ?", "claim_call_id = ?"], [claim.holder, claim.call_id])
        _log(conn, identity, "taken_over", held, claim.holder)
        record_overrides(conn, identity, ["claim"], claim.holder)
        answer = read_model.present(conn, read_model.item_by_id(conn, identity), full=True)
    return answer


def deferral_of(conn: sqlite3.Connection, reference: str) -> deferral.Held | None:
    """The condition the item stands put off on, or None, for a write that puts it back."""

    return deferral.held(conn, str(read_model.item_row(conn, reference)["work_item_id"]))


@dataclasses.dataclass(frozen=True)
class PriorClaim:
    """A claim as a write found it: who held the item, and the call that took it.

    `call_id` is `work_items.claim_call_id`, None for a claim no call took. The lease
    is read from that call (`leases.lease`), so a claim put back with it reads as it
    did before.
    """

    holder: str
    call_id: int | None


def claim_of(conn: sqlite3.Connection, reference: str) -> PriorClaim | None:
    """The item's claim with the call that took it, or None, for a write that puts it back."""

    row = read_model.item_row(conn, reference)
    holder = str(row["claim_ref"] or "")
    if not holder:
        return None
    call = row["claim_call_id"]
    return PriorClaim(holder, None if call is None else int(call))


@_marked
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
    cancels: object = None,
    ruled: str | None = None,
    following: object = None,
    gated: bool = False,
    agreed: str | None = None,
) -> dict:
    """`transition_work_item`, sparing the refusals named in `spared`; `ruled` is the
    label whose rule accepts the item on this move (`label_rule`); `agreed` is the line
    of the summary of decisions a cancel the sessions agreed to marks (`cancel_agreed`)."""

    row = _row_for_write(conn, reference, expected_revision)
    named = model.named_basis(acceptance)
    identity = str(row["work_item_id"])
    current = read_model.state_by_id(conn, str(row["state_id"]))
    target = _destination(conn, row, states.resolve(conn, str(row["workflow_id"]), state))
    cancel = target["category"] == "cancelled" and current["category"] != "cancelled"
    followed = _following(conn, row, following, cancel)
    gate = _cancel_point(conn, row, followed) if gated and cancel else None
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
    gives = LABEL_RULE if ruled is not None else _basis(conn, row, target, named)
    refusals, warnings = transitions.findings(
        conn,
        row,
        target,
        reason=reason,
        basis=row["acceptance"] or gives,
        to_check=check,
        settings=participation.load(conn),
    )
    refusals = [finding for finding in refusals if finding[0] not in spared]
    transitions.refuse(refusals, force)
    # Past every other refusal, so the list it hands over is the last thing in the way.
    cancelling = _cancel_listing(conn, row, current, target, cancels)
    if gate is not None and (gate.mode == participation.HUMAN or gate.busy):
        # Checked as the cancel would be made now, it is the owner's to make, or the
        # sessions' whose work it ends to hear first: it waits.
        return _ask_about_cancel(conn, row, target, note, author, warnings, gate, followed)
    confirming = _goal_close(conn, row, current, target) if gated else None
    if confirming == participation.HUMAN:
        # Checked as the close would be made now, confirming the goal is the owner's: it
        # waits on their question `confirm`.
        return _ask_about_close(conn, row, target, note, author, warnings)
    in_goal = _accepted_in_goal(conn, row, current, gives, named) if gated else None
    if in_goal == participation.HUMAN:
        # Checked as the move would be made now, taking the task on is the owner's: it
        # stays in triage under its goal and waits for the answer.
        waits = _ask_about_task(conn, identity, str(row["parent_id"]), author)
        answer = read_model.present(conn, read_model.item_by_id(conn, identity), full=True)
        answer["warnings"] = warnings
        answer["waits_for_owner"] = waits.answer()
        return answer
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
    # Whether the item is open, or a goal or stage stands accepted and open, is what
    # its parent derives from, and a goal or stage derives from it too.
    closing.note(conn, row["parent_id"], author)
    if row["kind"] == model.CONTAINER_KIND:
        closing.note(conn, identity, author)
    returned: list[str] = []
    if cancelling is not None:
        warnings += _cancel_under(conn, cancelling, note, author, returned)
    _write(conn, row, updates, parameters)
    if gives is not None:
        _accepted(
            conn,
            identity,
            gives,
            author,
            named=named,
            in_goal=in_goal == participation.AGENT,
            ruled=ruled,
        )
    _settled_by_owner(conn, identity, str(current["category"]), target, author)
    if opened:
        # Entering the service state names no state: it is the goal's or stage's opening.
        _log(conn, identity, "opened", note, author)
    else:
        moved = _log(
            conn,
            identity,
            "transitioned",
            f"{target['key']}: {note}" if note else str(target["key"]),
            author,
        )
        if gate is not None:
            # A cancel the setting, or the owner's answer it follows, left to the agent.
            decisions.mark(conn, moved, gate.point, _cancel_what(conn, row, followed))
        if agreed is not None:
            decisions.mark(conn, moved, "cancel_shared", agreed)
        if confirming == participation.AGENT:
            decisions.mark(conn, moved, "goal_close", _close_what(conn, row))
    if held:
        _log(conn, identity, "released", held, author)
    for step in unheld:
        _log(conn, identity, "checklist_released", step["text"][:120], author)
    if target["is_terminal"]:
        # A close ends what still waits on the item, saying how it closed; reopening
        # brings none of it back. A write that waited for the owner is dropped with it.
        ended = questions.closed_reason(str(target["category"]))
        pending.drop_on(
            conn, identity, f"the item closed in {target['key']}", reason=ended, author=author
        )
        questions.end(conn, identity, ended, author)
    elif out_of_review:
        # The question of review is about the work as it stood there: a move that takes
        # the item elsewhere takes it back.
        questions.end(conn, identity, "withdrawn", author, purpose=transitions.REVIEW)
    if current["category"] == "deferred" and target["category"] != "deferred":
        _put_off_ends(conn, identity, author)
    if target["is_terminal"] and not current["is_terminal"]:
        # What was put off until this item comes back in the same transaction.
        how = "cancelled" if target["category"] == "cancelled" else "completed"
        returned += _return_waiting(conn, [identity], how)
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
    overridden = record_overrides(conn, identity, [guard for guard, _ in refusals], author)
    answer = read_model.present(conn, read_model.item_by_id(conn, identity), full=True)
    answer["warnings"] = warnings
    if held:
        answer["released"] = held
    if overridden:
        answer["overridden"] = overridden
    if asked is not None:
        answer["review_request_id"] = asked
    closed = [identity]
    if cancelling is not None:
        # A goal or stage is never held: what the cancel released is the work under it.
        answer["cancelled"] = [entry["reference"] for entry in cancelling.listing.cancels]
        answer["released"] = cancelling.listing.released()
        closed += [str(found["work_item_id"]) for found in cancelling.listing.rows]
    if target["is_terminal"] and not current["is_terminal"]:
        answer["freed"] = closing.freed(conn, closed)
        answer["returned"] = returned
    for name in ("released", "freed", "returned"):
        if name in answer and not answer[name]:
            del answer[name]
    return answer


# -- putting work off -----------------------------------------------------------


#: The refusal putting work off is spared: entering deferred is what it does, with
#: the condition a move there does not name.
_DEFER_SPARES = frozenset({"deferred"})


@_marked
def defer_work_item(
    conn: sqlite3.Connection,
    reference: str,
    *,
    until: object,
    reason: object,
    force: bool = False,
    expected_revision: int | None = None,
    author: str | None = None,
    gated: bool = False,
) -> dict:
    """Put an item off until a day, a time or another item's close (`deferral`).

    It moves to the first deferred state its workflow reaches, and the move records
    `deferred: until 2026-12-01: <reason>`; like every move there it takes the basis
    away and ends the claims. The condition is written beside it in the same write,
    under the call that put it off. An item put off already takes the new condition,
    and the question whether to take it up again ends with the old one. A claim of
    another session is refused without `force`, which records it as overridden.
    The answer names the condition as `deferred`.

    `gated` says the write is the caller's own, as a surface takes it: an agent's
    putting off of an accepted goal or stage takes back the owner's acceptance, and is
    the owner's to make where `goal_defer` says `human`. Then the item stays as it is
    and the answer names what waits in `waits_for_owner` (`_ask_about_put_off`); left
    to the agent, it is marked in the summary of decisions.
    """

    row = _row_for_write(conn, reference, expected_revision)
    identity = str(row["work_item_id"])
    named = read_model.reference(conn, row)
    current = read_model.state_by_id(conn, str(row["state_id"]))
    if current["is_terminal"]:
        raise model.PlanningError(
            f"[{deferral.TAG}] {named} is closed: reopen it before putting it off"
        )
    why = _put_off_reason(reason)
    until_at, until_item, said = _condition(conn, row, until)
    target: sqlite3.Row | None = (
        current if current["category"] == "deferred" else states.reachable(conn, row, "deferred")
    )
    if target is None:
        raise model.WorkflowGuardError(
            f"[transition] {named} cannot be put off: its workflow has no deferred state it"
            " can move to"
        )
    overridden = held_elsewhere(conn, [row], author, force, doing="put it off")
    putting_off = _goal_defer(conn, row) if gated else None
    if putting_off == participation.HUMAN:
        # Checked as the move would be made now, taking the acceptance back is the owner's.
        refusals, warnings = transitions.findings(
            conn, row, target, reason=why, settings=participation.load(conn)
        )
        transitions.refuse([found for found in refusals if found[0] not in _DEFER_SPARES], False)
        answer = read_model.present(conn, row, full=True)
        answer["warnings"] = warnings
        answer["waits_for_owner"] = _ask_about_put_off(conn, row, said, why, author).answer()
        return answer
    answer = _transition(
        conn,
        identity,
        str(target["state_id"]),
        reason=f"until {said}: {why}",
        author=author,
        spared=_DEFER_SPARES,
    )
    if putting_off == participation.AGENT:
        decisions.mark(
            conn,
            _last_event(conn, identity, "transitioned"),
            "goal_defer",
            _put_off_what(named, said, why),
        )
    questions.end(conn, identity, "withdrawn", author, purpose=deferral.RETURN)
    deferral.put(
        conn,
        identity,
        until_at=until_at,
        until_item_id=until_item,
        reason=why,
        call_id=calls.call_id(conn, identity),
        since=deferral.stamp(leases.utc_now()),
    )
    forced = record_overrides(conn, identity, ["claim"] if overridden else [], author)
    answer = {
        **answer,
        **read_model.present(conn, read_model.item_by_id(conn, identity), full=True),
    }
    if forced:
        answer["overridden"] = forced
    return answer


def defer_again(conn: sqlite3.Connection, identity: str, until: object) -> None:
    """Put work that came back off again until `until`, as the owner's answer `later` says.

    The item stays where it stands; its condition is the new one, set by the call of
    the answer, not yet come, with the reason and the start it was put off with. The
    answer's own event is the history of it.
    """

    row = _row_for_write(conn, identity, None)
    kept = deferral.held(conn, identity)
    if kept is None:
        raise model.PlanningError(
            f"[{deferral.TAG}] {read_model.reference(conn, row)} is not put off"
        )
    until_at, until_item, _said = _condition(conn, row, until)
    deferral.put(
        conn,
        identity,
        until_at=until_at,
        until_item_id=until_item,
        reason=kept.reason,
        call_id=calls.call_id(conn, identity),
        since=kept.since,
    )


def return_due(
    conn: sqlite3.Connection, *, limit: int | None = None, space_id: str | None = None
) -> int:
    """Bring back the put-off work whose condition came and nothing acted on; how much.

    A day or time that passed, or an item that closed by a path that did not bring
    its waiting back. Read with `leases.utc_now`, at most `limit` items, of one
    space's items when `space_id` names it. The sweep's `returns` step and the
    take-next queue call it; a read never does.
    """

    found = deferral.due(
        conn, deferral.stamp(leases.utc_now()), -1 if limit is None else limit, space_id=space_id
    )
    for due in found:
        return_deferred(conn, due)
    return len(found)


def _return_waiting(conn: sqlite3.Connection, items: list[str], because: str) -> list[str]:
    """Bring back what was put off until one of `items`, which closed or goes; the
    references of those whose condition came with it."""

    found = (
        return_deferred(conn, deferral.Due(waiting_id, because, until_id, None))
        for waiting_id, until_id in deferral.waiting(conn, items)
    )
    return [reference for reference in found if reference is not None]


def return_deferred(conn: sqlite3.Connection, due: deferral.Due) -> str | None:
    """Bring one put-off item back, its condition having come; its reference.

    The return is Valkama's own call (`deferral.RETURN_TOOL`), so the history names
    the server and why. Under no accepted chain the item moves to the first triage
    state it reaches, with `transitioned` (`triage: returned, date 2026-12-01`) and
    `returned` (`date 2026-12-01`, `completed MAIN-12`) side by side, and its
    condition goes with the move; a goal, where the owner decides on goals an agent
    proposes, waits there on the owner's question about it, as such a goal does.
    Under goals and stages all accepted and open, or
    with no triage to reach, it stays put off: its condition is marked come and the
    owner is asked whether to do it, put it off again or drop it. A condition that
    came before was asked about then: the item it waits on closing again or going
    asks nothing new, and the answer is None.
    """

    row = read_model.item_by_id(conn, due.work_item_id)
    reference = read_model.reference(conn, row)
    item = None if due.until_item_id is None else deferral.reference(conn, due.until_item_id)
    with calls.bind(calls.valkama(), deferral.RETURN_TOOL):
        current = read_model.state_by_id(conn, str(row["state_id"]))
        if current["category"] != "deferred":
            # A condition with no item put off on it holds nothing: it goes.
            deferral.clear(conn, due.work_item_id)
            return reference
        target = states.reachable(conn, row, "triage")
        parent = None if row["parent_id"] is None else str(row["parent_id"])
        if target is None or item_tree.accepted_chain(conn, parent):
            if not deferral.reach(
                conn,
                due.work_item_id,
                deferral.stamp(leases.utc_now()),
                gone=due.because == deferral.DELETED,
            ):
                return None
            condition = deferral.said(str(due.until_at)) if item is None else f"{item} closed"
            questions.ask(
                conn,
                due.work_item_id,
                kind="question",
                prompt=(
                    f"{reference} was put off until {condition}; that has come. Do it, put it"
                    " off again, or drop it."
                ),
                fields=request_model.fields(list(request_model.RETURN_FIELDS)),
                author=deferral.AUTHOR,
                purpose=deferral.RETURN,
            )
            return reference
        said = deferral.because_text(due.because, due.until_at, item)
        _transition(
            conn,
            due.work_item_id,
            str(target["state_id"]),
            reason=f"returned, {said}",
            author=deferral.AUTHOR,
        )
        _log(conn, due.work_item_id, "returned", said, deferral.AUTHOR)
        if (
            row["kind"] == model.CONTAINER_KIND
            and parent is None
            and participation.load(conn).mode(str(row["planning_space_id"]), "proposed_goal")
            == participation.HUMAN
        ):
            # A goal back in triage is the owner's to take on again, as one an agent
            # proposes: Valkama asks, and the answer decides it.
            _ask_about_goal(conn, due.work_item_id, deferral.AUTHOR, by_agent=False)
    return reference


def _put_off_ends(conn: sqlite3.Connection, identity: str, author: str | None) -> None:
    """The item left deferred: its condition goes, and the question its coming asked."""

    deferral.clear(conn, identity)
    questions.end(conn, identity, "withdrawn", author, purpose=deferral.RETURN)


#: The most characters the reason for putting work off holds.
PUT_OFF_REASON_LIMIT = 400


def _put_off_reason(reason: object) -> str:
    if reason is None or (isinstance(reason, str) and not reason.strip()):
        raise model.PlanningError(
            f"[{deferral.TAG}] defer needs reason: why the work waits, which the owner reads"
            " when it comes back"
        )
    return model.text_field(reason, "reason", limit=PUT_OFF_REASON_LIMIT)


def _goal_defer(conn: sqlite3.Connection, row: sqlite3.Row) -> str | None:
    """How an agent's putting off of an item goes, by the owner's setting of its space; None
    for any but an accepted goal or stage, whose acceptance it takes back. A task, and a
    goal or stage nobody accepted, the agent puts off at any setting."""

    if not calls.from_agent() or row["kind"] != model.CONTAINER_KIND or row["acceptance"] is None:
        return None
    return participation.load(conn).mode(str(row["planning_space_id"]), "goal_defer")


def _put_off_what(reference: str, until: str, why: str) -> str:
    """What the summary of decisions says of putting a goal or stage off."""

    return f"put off {reference} until {until}: {why}"


def _ask_about_put_off(
    conn: sqlite3.Connection, row: sqlite3.Row, until: str, why: str, author: str | None
) -> pending.Waiting:
    """Ask the owner whether to put off an accepted goal or stage an agent puts off until
    `until`, which waits on the answer (`requests.carry_out`): keep it, put it off, the
    agent's condition standing when the answer names none, or drop it."""

    reference = read_model.reference(conn, row)
    return pending.ask(
        conn,
        str(row["work_item_id"]),
        "goal_defer",
        pending.Proposal(
            "defer",
            {"until": until, "reason": why},
            _put_off_what(reference, until, why),
            reason=why,
            proposed={"until": until},
        ),
        purpose="goal",
        prompt=(
            f"An agent puts off {reference}, an accepted {_container_word(row)}: {row['title']}."
            f" Until {until}. Its reason: {why}. Keep it, put it off, or drop it."
        ),
        fields=request_model.fields(request_model.put_off_fields(until)),
        author=author,
    )


def _condition(
    conn: sqlite3.Connection, row: sqlite3.Row, until: object
) -> tuple[str | None, str | None, str]:
    """The condition `until` names for the item: the moment or the item it waits on,
    and how a person reads it."""

    if until is None or (isinstance(until, str) and not until.strip()):
        raise model.PlanningError(
            f"[{deferral.TAG}] defer needs until: a day YYYY-MM-DD, a time with its zone, or"
            " the reference of the open item it waits on"
        )
    text = model.text_field(until, "until", limit=64)
    at = deferral.moment(text, leases.utc_now())
    if at is not None:
        return at, None, deferral.said(at)
    try:
        waited = read_model.item_row(conn, text)
    except model.PlanningError as error:
        raise model.PlanningError(
            f"[{deferral.TAG}] until {text} is no day, time or work item: send a day"
            " YYYY-MM-DD, a time with its zone such as 2026-12-01T09:00:00Z, or an item's"
            " reference"
        ) from error
    deferral.check_item(conn, row, waited)
    return None, str(waited["work_item_id"]), read_model.reference(conn, waited)


def _cancel_listing(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    current: sqlite3.Row,
    target: sqlite3.Row,
    cancels: object,
) -> _Cancelling | None:
    """The list a cancel of a goal or stage closes, once `cancels` confirms it; else None.

    A goal or stage with open work under it is refused with the list until `cancels`
    is the token of the list the server builds now: none sent, or one of a list that
    changed since, and the refusal hands over the list as it stands. One with nothing
    open under it is cancelled alone, as a task is, and a token sent for it confirms
    a list that has emptied. An item under it whose workflow cannot be cancelled from
    where it stands refuses the whole cancel, before any list is handed over. Sent
    with any other move, `cancels` is refused rather than dropped.
    """

    cancelling = (
        row["kind"] == model.CONTAINER_KIND
        and target["category"] == "cancelled"
        and current["category"] != "cancelled"
    )
    if not cancelling:
        if cancels is not None:
            raise model.PlanningError(
                "cancels goes with cancelling a goal or stage, whose list it confirms; a move"
                f" to {target['name']} of {read_model.reference(conn, row)} cancels no list:"
                " leave it out"
            )
        return None
    sent = None if cancels is None else model.text_field(cancels, "cancels", limit=64)
    listing = closing.cancel_list(conn, row)
    if listing is None:
        return None
    targets = []
    for found in listing.rows:
        target_state = states.cancel_state(conn, found)
        if target_state is None:
            raise model.WorkflowGuardError(
                f"[transition] {read_model.reference(conn, found)} is under"
                f" {listing.reference} and cannot be cancelled from where it stands: its"
                " workflow has no transition to a cancelled state; move it where one leads"
            )
        targets.append(target_state)
    if sent != listing.token:
        raise listing.refusal(stale=sent is not None)
    return _Cancelling(listing, targets)


@dataclasses.dataclass(frozen=True)
class _Cancelling:
    """A confirmed cancel list, and the cancelled state each of its rows moves to."""

    listing: closing.CancelList
    targets: list[sqlite3.Row]


# -- a cancel the owner may decide on --------------------------------------------

#: How an agent's cancel goes when it follows an owner's answer, whatever the setting
#: says: with no question of the owner, made at once, or once the sessions whose work it
#: ends agree.
FOLLOWING = "following"

#: The call that filed an item: the session it proved, and whether it proved one.
_FILED_BY = (
    "SELECT c.session_id, c.identity_state FROM work_item_events e"
    " JOIN execution_events c ON c.id = e.call_id"
    " WHERE e.work_item_id = ? AND e.action = 'created' ORDER BY e.id LIMIT 1"
)


def _following(
    conn: sqlite3.Connection, row: sqlite3.Row, following: object, cancel: bool
) -> str | None:
    """The owner's answered question a cancel names as what it follows from, or None.

    It is a question to the owner, not one asked of a session, on the item or a goal
    or stage over it, answered by a person; anything else is refused before a thing is
    written. That the cancel follows from it is the caller's word. Sent with any move
    but a cancel, it is refused rather than dropped.
    """

    if following is None:
        return None
    if not cancel:
        raise model.PlanningError(
            "[participation] following names the owner's answer a cancel follows from:"
            " leave it out of any other move"
        )
    named = model.text_field(following, "following", limit=64)
    chain = [
        identity for identity, _kind, _category in item_tree.above(conn, str(row["work_item_id"]))
    ]
    if not questions.answered_by_owner(conn, named, chain):
        raise model.PlanningError(
            "[participation] following names no answered question of the owner on this item"
            " or above it"
        )
    return named


@dataclasses.dataclass(frozen=True)
class _CancelGate:
    """How an agent's own cancel of an item goes, at the point that decides it.

    `mode` is `human`, `agent` or `following`; `busy` the live sessions besides the
    caller's that work on the item, which a cancel at `cancel_shared` asks.
    """

    point: str
    mode: str
    busy: tuple[str, ...] = ()


def _cancel_point(
    conn: sqlite3.Connection, row: sqlite3.Row, followed: str | None
) -> _CancelGate | None:
    """How an agent's own cancel of the item goes; None, it is made as any cancel is.

    A person's cancel and Valkama's are the owner's own. A cancel of work other live
    sessions do, a goal's or a stage's participants or a task's holders, asks them
    (`cancel_shared`): the setting of its space says whether the owner decides at
    once, and a cancel that follows an owner's answer asks the sessions alone, as one
    the setting leaves to the agent does. An item the caller's own work filed, by a
    call of the caller's top-level session, is the agent's to cancel. Any other the
    setting decides (`cancel_outside`), unless the cancel follows an owner's answer:
    then, as where the setting says `agent`, it is made and marked in the summary of
    decisions.
    """

    if not calls.from_agent():
        return None
    caller = calls.confirmed_session()
    busy = tuple(session for session in working.working(conn, row) if session != caller)
    if busy:
        settings = participation.load(conn)
        mode = settings.mode(str(row["planning_space_id"]), "cancel_shared")
        return _CancelGate("cancel_shared", FOLLOWING if followed else mode, busy)
    filed = conn.execute(_FILED_BY, (str(row["work_item_id"]),)).fetchone()
    own = (
        caller is not None
        and filed is not None
        and filed["identity_state"] == calls.CONFIRMED
        and filed["session_id"] == caller
    )
    if own:
        return None
    if followed is not None:
        return _CancelGate("cancel_outside", FOLLOWING)
    mode = participation.load(conn).mode(str(row["planning_space_id"]), "cancel_outside")
    return _CancelGate("cancel_outside", mode)


def _cancel_what(conn: sqlite3.Connection, row: sqlite3.Row, followed: str | None) -> str:
    """What the summary of decisions says of a cancel: `cancel MAIN-12`, and the
    question it follows (`following question <id>`)."""

    said = f"cancel {read_model.reference(conn, row)}"
    return said if followed is None else f"{said} following question {followed}"


#: What the owner's question says of the item an agent cancels, at each point.
_CANCEL_ASKED = {
    "cancel_outside": "filed outside its own work",
    "cancel_shared": "which other sessions work on",
}
#: What the question then asks the owner to do.
CANCEL_OR_KEEP = " Cancel it, or keep it."


def cancel_asked(conn: sqlite3.Connection, row: sqlite3.Row, point: str, reason: str | None) -> str:
    """The owner's question about an agent's cancel at `point`, up to what it asks them to
    do: the item, why it is the owner's to decide, and the agent's reason."""

    return (
        f"An agent cancels {read_model.reference(conn, row)}, {_CANCEL_ASKED[point]}:"
        f" {row['title']}.{_reason_said(reason)}"
    )


def _ask_about_cancel(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    target: sqlite3.Row,
    reason: str,
    author: str | None,
    warnings: list[str],
    gate: _CancelGate,
    followed: str | None,
) -> dict:
    """Keep back an agent's cancel that waits on an answer: the item stays as it is.

    At `cancel_outside` the owner is asked whether to make it (`requests.carry_out`). At
    `cancel_shared` the sessions whose work it ends are asked at once as well
    (`pending.ask_sessions`): beside the owner's question where the setting says
    `human`, whose answer then decides and shows theirs; alone otherwise, and then the
    cancel waits for them (`waits_for_sessions`) and their answers decide it, or pass it
    to the owner (`consent.settle`). The action keeps where the item stood, who held it
    and what its cancel list held (`pending.cancel_seen`); an answer reads the list as
    it stands then. The same cancel sent again while it waits answers the same wait
    and asks nobody again.
    """

    identity = str(row["work_item_id"])
    proposal = pending.Proposal(
        "transition",
        {"state": str(target["key"]), "reason": reason},
        _cancel_what(conn, row, followed),
        seen=pending.cancel_seen(conn, row),
        reason=reason or None,
        proposed={"state": "cancelled"},
    )
    action, fresh = pending.hold(conn, identity, gate.point, proposal)
    asked = cancel_asked(conn, row, gate.point, reason)
    question = pending.owner_question(conn, action)
    if fresh and gate.mode == participation.HUMAN:
        shown = " The sessions are asked as well, and their answers show here." if gate.busy else ""
        question = pending.ask_owner(
            conn,
            action,
            purpose="cancel",
            prompt=asked + shown + CANCEL_OR_KEEP,
            fields=request_model.fields(request_model.cancel_fields()),
            author=author,
        )
    if fresh and gate.busy:
        pending.ask_sessions(
            conn,
            action,
            list(gate.busy),
            prompt=f"Another session's agent cancels {read_model.reference(conn, row)}, work"
            f" you take part in: {row['title']}.{_reason_said(reason)} Answer agree, object with a"
            " reason, or move your work out of it with move_out and answer moved_out.",
            author=author,
        )
    answer = read_model.present(conn, read_model.item_by_id(conn, identity), full=True)
    answer["warnings"] = warnings
    if question:
        answer["waits_for_owner"] = pending.Waiting(
            action.id, gate.point, question, action.what
        ).answer()
    else:
        answer["waits_for_sessions"] = pending.round_of(conn, action).answer()
    return answer


def _reason_said(reason: str | None) -> str:
    """The agent's reason, as a question about its cancel says it."""

    return f" Its reason: {reason}." if reason else ""


def cancel_agreed(
    conn: sqlite3.Connection,
    reference: str,
    state: str,
    *,
    reason: str,
    cancels: str | None,
    what: str,
    author: str | None,
) -> dict:
    """Make a cancel the sessions whose work it ends agreed to, as Valkama's write: the
    write the agent asked for, marked `cancel_shared` in the summary of decisions with
    `what`, the line the agent's cancel carried."""

    return _transition(
        conn, reference, state, reason=reason, cancels=cancels, author=author, agreed=what
    )


# -- a goal's close the owner may decide on --------------------------------------


def _goal_close(
    conn: sqlite3.Connection, row: sqlite3.Row, current: sqlite3.Row, target: sqlite3.Row
) -> str | None:
    """How an agent's confirmation of a goal goes, by the owner's setting of its space; None
    for any other move. A confirmation is a completion of a goal, a goal or stage with no
    parent, that awaits it: nothing under it is open. A stage the agent closes at any
    setting: the owner confirms the goal it is part of."""

    if not calls.from_agent() or row["kind"] != model.CONTAINER_KIND or row["parent_id"]:
        return None
    if target["category"] != "completed" or current["category"] == "completed":
        return None
    identity = str(row["work_item_id"])
    if item_tree.below(conn, [identity]).container_state(identity) != closing.AWAITING:
        return None
    return participation.load(conn).mode(str(row["planning_space_id"]), "goal_close")


#: How much of the agent's summary the owner's question about its close quotes.
_SUMMARY_SHOWN = 1000


def _close_what(conn: sqlite3.Connection, row: sqlite3.Row) -> str:
    """What the summary of decisions says of a goal's close: `close MAIN-3`."""

    return f"close {read_model.reference(conn, row)}"


def _ask_about_close(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    target: sqlite3.Row,
    reason: str,
    author: str | None,
    warnings: list[str],
) -> dict:
    """Keep back an agent's confirmation of a goal: the goal stays as it is, and the owner
    is asked to confirm it, the agent's summary shown (`requests.carry_out`).

    The question is the one its period of waiting asks: when the sweep asked it already,
    the action waits on that question; else the agent's call asks it, and the period
    records it, so the sweep asks nothing more. The same close sent again while it
    waits answers the same wait."""

    identity = str(row["work_item_id"])
    summary = model.summary(row["summary"], required=False) or {}
    proposal = pending.Proposal(
        "transition",
        {"state": str(target["key"]), "reason": reason},
        _close_what(conn, row),
        reason=reason or None,
        proposed={"summary": summary},
    )
    action, fresh = pending.hold(conn, identity, "goal_close", proposal)
    question = pending.owner_question(conn, action)
    if fresh:
        asked = closing.open_question(conn, identity)
        if asked is not None:
            pending.join(conn, action, asked)
            question = asked
        else:
            part = closing.confirmation(conn, row)
            steps = [str(step["text"]) for step in model.checklist(row["checklist"])]
            reference = read_model.reference(conn, row)
            done = str(summary.get("done") or "").strip()[:_SUMMARY_SHOWN]
            head = (
                f"An agent confirms {reference}: all work under it is closed"
                + (f", and its summary says: {done}" if done else "")
                + ". Confirm it, or leave it to the next session that takes work in this space."
            )
            question = pending.ask_owner(
                conn,
                action,
                purpose=closing.CONFIRM,
                prompt=closing.prompt(reference, part, steps, head=head),
                fields=request_model.fields(list(request_model.CONFIRM_FIELDS)),
                author=author,
            )
            closing.asked(conn, identity, question)
    answer = read_model.present(conn, read_model.item_by_id(conn, identity), full=True)
    answer["warnings"] = warnings
    answer["waits_for_owner"] = pending.Waiting(
        action.id, action.point, question, action.what
    ).answer()
    return answer


#: What a cancel of a goal or stage does not ask of the work under it: the guard holds
#: for the item the caller named, and the cancel closes the rest with it.
_CASCADE_SPARES = frozenset({"person_spoke"})


def _cancel_under(
    conn: sqlite3.Connection,
    cancelling: _Cancelling,
    why: str,
    author: str | None,
    returned: list[str],
) -> list[str]:
    """Cancel every open item under a goal or stage, deepest first, each with its summary.

    Each moves to the first cancelled state its workflow reaches, with the reason
    `cancelled with MAIN-3`, through the one transition path: its claims end, its
    questions end as cancelled, and what was put off until it comes back, named in
    `returned`. An item without a summary gets one that says so; one with a summary
    keeps what it did and says nothing comes next. The new summary is a new report,
    and the one before stays in the comments. `why`, the reason the goal or stage was
    cancelled for, is each summary's `why` when there is one.
    """

    warnings: list[str] = []
    served = cancelling.listing.reference
    reason = f"cancelled with {served}"
    for found, target in zip(cancelling.listing.rows, cancelling.targets, strict=True):
        identity = str(found["work_item_id"])
        set_summary(conn, identity, _cancelled_summary(found, served, why), author=author)
        moved = _transition(
            conn,
            identity,
            str(target["state_id"]),
            reason=reason,
            author=author,
            spared=_CASCADE_SPARES,
        )
        warnings += moved["warnings"]
        returned += moved.get("returned", [])
    return warnings


def _cancelled_summary(row: sqlite3.Row, served: str, why: str) -> dict:
    """The summary an item cancelled with the goal or stage `served` closes with."""

    said = model.summary(row["summary"], required=False)
    if said is None or not str(said.get("done") or "").strip():
        summary = {
            "done": f"Cancelled with {served}.",
            "next": "Nothing: the goal or stage it served was cancelled.",
        }
    else:
        summary = {
            "done": str(said["done"]),
            "next": f"Nothing: cancelled with {served}, the goal or stage it served.",
        }
    if why:
        summary["why"] = why
    return summary


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
        found = str(child["work_item_id"])
        if container:
            closing.note(conn, found, author)
        _write(conn, child, updates, parameters)
        _log(conn, found, "accepted", basis, author)
        if container:
            _log(conn, found, "opened", "", author)
            warnings += _cascade(conn, found, accepted, basis, author)
        else:
            _log(conn, found, "transitioned", f"{target['key']}: accepted with {accepted}", author)
        # Accepted with its goal or stage by a person, it is answered as if taken on alone.
        _settled_by_owner(conn, found, "triage", target, author)
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
    settings = participation.load(conn)
    lease = leases.lease(conn, row, settings=settings)
    expired = False
    if lease is not None and leases.abandoned(lease) and not leases.held_by(lease, caller, actor):
        row = _expire(conn, row, lease, _lapsed_steps(conn, row, lease, settings=settings))
        lease, expired = None, True
    held = lease.holder if lease is not None else ""
    holder = lease is not None and leases.held_by(lease, caller, actor)
    identity = str(row["work_item_id"])
    carried: list[str] = []
    start: _Start | None = None
    if release:
        if expired:
            # The lease this release named is already gone, released above.
            return read_model.present(conn, row, full=True, settings=settings)
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
        start = _starting(conn, row, move_state, settings=settings)
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
            return _claim_lost(conn, row, actor, settings)
        if taking_over:
            carried.append("claim")
            _log(conn, identity, "taken_over", held, author)
        else:
            _log(conn, identity, "claimed", "", author)
        _started(conn, identity, start, author, start_reason)
        waiting.deliver(conn, row)
    overridden = record_overrides(conn, identity, carried, author)
    requeued = _settle(conn, identity, author, "released") if release else None
    answer = read_model.present(
        conn, read_model.item_by_id(conn, identity), full=True, settings=settings
    )
    if requeued is not None:
        answer["requeued"] = requeued
    if start is not None:
        _say_started(conn, answer, start, settings)
    if overridden:
        answer["overridden"] = overridden
    return answer


def _holdable(conn: sqlite3.Connection, row: sqlite3.Row) -> None:
    """Refuse a claim, of the item or of a step, on what nobody holds.

    One refusal for every way in -- a claim, the queue, a batch, a creation that
    claims, HTTP and a launch -- before anything is written. A goal or stage is
    never held; an item in review waits on the owner's answer, and a closed one is
    reopened before anybody works it again. An agent does not take work the owner is
    asked whether to do, on the item or over an item with no basis
    (`questions.acceptance_asked`, `acceptance_question`).
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
    if not calls.from_agent():
        # A person's claim is their answer (`_settled_by_owner`).
        return
    asked = questions.acceptance_asked(conn, row)
    if asked is not None:
        # Taking it would start it on an assignment the owner has not given: whether
        # it is to be done is the question.
        raise model.WorkflowGuardError(
            f"[acceptance_question] the owner has not decided whether"
            f" {read_model.reference(conn, row)} is to be done"
            f" (question {asked['request_id']}): take it after the answer"
        )


#: Why the write waiting on a question whether to do an item no longer waits, when a
#: person takes the item or moves it on: the detail of its `action_dropped`.
TAKEN_BY_OWNER = "taken by the owner"


def _settled_by_owner(
    conn: sqlite3.Connection, identity: str, left: str, entered: sqlite3.Row, author: str | None
) -> None:
    """End the questions whether to do the item that a person's write moving it out of the
    category `left` into `entered` answered, called by every write that moves a card.

    A person's write that takes an item out of triage or deferred, where the owner may
    be asked whether to do it, into another category without closing it decides that
    question: a claim, a move, a putting off, or the acceptance of the goal or stage
    over it that takes it along (`_cascade`). Each such question on the item itself
    (`questions.acceptance_left`) is withdrawn, and a write waiting on one is dropped as
    taken by the owner. A question over the item stays, an agent's write answers none,
    and a close ends the questions as it closes.
    """

    if calls.from_agent() or left not in model.UNACCEPTED_CATEGORIES:
        return
    if entered["category"] == left or entered["is_terminal"]:
        return
    for question in questions.acceptance_left(conn, identity, left):
        action = pending.of_request(question)
        if action is not None:
            found = pending.get(conn, action)
            pending.end(conn, found, pending.DROPPED, author=author, why=TAKEN_BY_OWNER)
        questions.end(conn, identity, "withdrawn", author, purpose=str(question["purpose"]))


@dataclasses.dataclass(frozen=True)
class _Start:
    """What a claim writes beside its holder: the state it starts in, the basis, the start."""

    updates: list[str]
    parameters: list[object]
    current: sqlite3.Row | None = None
    target: sqlite3.Row | None = None
    gives: str | None = None


def _starting(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    move_state: bool = True,
    *,
    settings: participation.Settings,
) -> _Start:
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
        conn, row, target, basis=row["acceptance"] or gives, held=True, settings=settings
    )
    transitions.refuse(refusals, False)
    parameters.append(str(target["state_id"]))
    updates = ["state_id = ?", *_accepting(row, target, gives, parameters)]
    return _Start(updates, parameters, current, target, gives)


def _started(
    conn: sqlite3.Connection, identity: str, start: _Start, author: str | None, reason: str
) -> None:
    """The history of the start a claim wrote with its holder: the basis, then the move.

    A start out of deferred ends the condition it stood there on, as any move out does.
    An acceptance an agent's claim makes alone is marked in the summary of decisions:
    the assignment it takes the work on, inside goals and stages all accepted too, and
    there a task in triage nobody triaged as `task_in_goal`, whatever the setting
    `task_in_goal` says, since a claim by number meets no gate.
    """

    if start.gives is not None:
        untriaged = start.current is not None and start.current["category"] == "triage"
        _accepted(
            conn,
            identity,
            start.gives,
            author,
            named=model.NAMED_BASIS,
            in_goal=untriaged and start.gives == "inherited",
        )
    if start.target is not None:
        _log(conn, identity, "transitioned", f"{start.target['key']}: {reason}", author)
    if start.current is not None and start.target is not None:
        # A person's claim is their answer.
        _settled_by_owner(conn, identity, str(start.current["category"]), start.target, author)
    if start.current is not None and start.current["category"] == "deferred":
        _put_off_ends(conn, identity, author)


def _say_started(
    conn: sqlite3.Connection, answer: dict, start: _Start, settings: participation.Settings
) -> None:
    """Name in a claim's answer where it started the item from and went, and its warnings."""

    if start.target is None or start.current is None:
        return
    answer["started"] = {"from": str(start.current["key"]), "to": str(start.target["key"])}
    row = read_model.item_by_id(conn, str(answer["work_item_id"]))
    warning = transitions.lease_warning(conn, row, str(answer["reference"]), settings=settings)
    if warning:
        answer["warnings"] = [warning]


#: The items a write in progress left without the holder their state needs, when it
#: is one write of several steps (`one_write`); None outside one.
_UNSETTLED: contextvars.ContextVar[dict[str, tuple[str | None, str]] | None] = (
    contextvars.ContextVar("planning_unsettled", default=None)
)


@contextlib.contextmanager
def one_write(conn: sqlite3.Connection) -> Iterator[list[str]]:
    """Hold the holder rule and the container marks to the end of several steps that are one write.

    A batch is one write: a task at work that lost its last holder in one step and
    went to review in the next went from work to review, not by way of ready. So
    inside this block `_settle` only notes the item, and the end of the block
    settles each item once, as the last step left it. The goals and stages the steps
    changed the work under are settled after that, once (`marking`), and the list
    this yields names, after the block, those that came to await confirmation.

    A block inside another joins it: the outer block's end settles both, and the
    inner one's list stays empty.
    """

    with marking(conn) as entered:
        if _UNSETTLED.get() is not None:
            yield entered
            return
        unsettled: dict[str, tuple[str | None, str]] = {}
        token = _UNSETTLED.set(unsettled)
        try:
            yield entered
        finally:
            _UNSETTLED.reset(token)
        for identity, (author, reason) in unsettled.items():
            _hand_back(conn, identity, author, reason)


#: Why an agent's close of a goal no longer waits: the goal stopped awaiting confirmation.
NO_LONGER_AWAITING = "it no longer awaits confirmation"


@contextlib.contextmanager
def marking(conn: sqlite3.Connection, person: waiting.Place | None = None) -> Iterator[list[str]]:
    """The container marks of one write (`closing.frame`), without the holder rule's wait.

    Every write route opens it, and so does every write here that changes the work
    under a goal or stage, so no path passes it by; one inside another joins it. At
    the end of the outermost the marked containers enter or leave the wait for their
    confirmation, the words left on one that stopped waiting go (`waiting.drop`) and so
    does an agent's close that waits on its confirmation (`dropped`), and the list this
    yields names the references of those that came to wait.

    `person` is where the history stood before a person's write, which the route
    passes to the frame it opens: what that write told nobody is left for the next
    session (`waiting.after_person`) after the wait is settled, so what entering it
    recorded counts, and before the words on a container that stopped waiting go, so
    a person's act that ended the wait leaves no words behind it.
    """

    with closing.frame(conn) as settled:
        yield settled.entered
    if person is not None:
        waiting.after_person(conn, person)
    for identity in settled.left:
        waiting.drop(conn, identity)
        # A confirmation an agent's close waits on goes with the wait, as its question did.
        for action in pending.open_on(conn, identity, "goal_close"):
            pending.end(
                conn, action, pending.DROPPED, author=closing.AUTHOR, why=NO_LONGER_AWAITING
            )


def _settle(
    conn: sqlite3.Connection, identity: str, author: str | None, reason: str
) -> dict | None:
    """Hold a task at work to having a holder, at the end of the write that is changing it.

    Outside `one_write` that end is now, and the answer is the move `_hand_back`
    made, for the caller's `requeued`; inside one the item waits for its end.
    """

    unsettled = _UNSETTLED.get()
    if unsettled is None:
        return _hand_back(conn, identity, author, reason)
    unsettled.setdefault(identity, (author, reason))
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
    """Whether a task stands at work with nobody holding it or any open step of it.

    A done step is nobody's hold, though a store an earlier build wrote may keep its holder.
    """

    return (
        current["category"] == "active"
        and not claim_ref
        and not any(step["claimed_by"] and not step["done"] for step in model.checklist(checklist))
    )


def _stranded(conn: sqlite3.Connection, row: sqlite3.Row) -> model.WorkflowGuardError:
    return model.WorkflowGuardError(
        f"[transition] {read_model.reference(conn, row)} would stand at work with nobody"
        " holding it: its workflow lets it reach no ready state to go back to; move it first"
    )


def _claim_lost(
    conn: sqlite3.Connection, row: sqlite3.Row, actor: str, settings: participation.Settings
) -> dict:
    """Answer a claim that lost its race the way a claim is supposed to fail.

    What a caller is promised is that a claim fails naming the holder, not that
    it reports a revision — so the answer to losing comes from re-reading who
    holds it now. Finding oneself there is the same outcome that was asked for,
    and saying so keeps a retry from being punished for the race it already won.
    """

    fresh = read_model.item_by_id(conn, str(row["work_item_id"]))
    lease = leases.lease(conn, fresh, settings=settings)
    if lease is not None and leases.held_by(lease, calls.current(), actor):
        return read_model.present(conn, fresh, full=True, settings=settings)
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
    for that item in particular. A hold of the session making the call stays, as
    `claim_work_item` keeps it: the call is that session's heartbeat, though
    nothing has written it yet. An item another writer changed in the meantime
    is left to it. With `limit`, it stops after releasing on that many items, by
    number, and leaves the rest to the next call.
    """

    expired = 0
    settings = participation.load(conn)
    for row, claim, steps in lapsed_holds(conn, settings=settings, space_id=space_id):
        if limit is not None and expired >= limit:
            break
        try:
            _expire(conn, row, claim, steps)
        except model.RevisionConflictError:
            continue
        expired += 1
    return expired


def lapsed_holds(
    conn: sqlite3.Connection, *, settings: participation.Settings, space_id: str | None = None
) -> Iterator[tuple[sqlite3.Row, leases.Lease | None, dict[str, leases.Lease]]]:
    """Each item `expire_leases` would release a hold on, by number: its row, claim and steps.

    `settings` is the caller's snapshot of the participation setting, which gives
    each item the quiet period of its space. The claim is the lapsed lease to
    release, or None when only steps lapsed. It
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
    mine = calls.confirmed_session()
    for row in conn.execute(query + " ORDER BY i.number", parameters).fetchall():
        asked = leases.question_stands(conn, row)
        lease = leases.lease(conn, row, settings=settings, asked=asked)
        lapsed = lease is not None and leases.lapsed(lease) and not _calling(lease, mine)
        claim = lease if lapsed else None
        steps = _lapsed_steps(conn, row, claim, settings=settings, asked=asked)
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
    settings: participation.Settings,
    asked: bool | None = None,
) -> dict[str, leases.Lease]:
    """The claimed steps of the item to release, by step id, each with its lease.

    A lapsed one, and, beside a claim being released, every step of the same
    holder: the lease is the session's, so what lapses for its claim lapses for
    its steps. A step of the session making the call stays, as its claim does.
    """

    if asked is None:
        asked = leases.question_stands(conn, row)
    mine = calls.confirmed_session()
    found: dict[str, leases.Lease] = {}
    read: dict[str, leases.Lease] = {}
    for step in model.checklist(row["checklist"]):
        holder = str(step["claimed_by"] or "")
        if step["done"] or not holder:
            continue
        if holder not in read:
            read[holder] = leases.of_step(conn, row, holder, settings=settings, asked=asked)
        held = read[holder]
        if _calling(held, mine):
            continue
        if leases.lapsed(held) or (claim is not None and _same_holder(held, claim)):
            found[str(step["id"])] = held
    return found


def _calling(lease: leases.Lease, session: str | None) -> bool:
    """Whether `lease` is the session's making the call: its call is its heartbeat."""

    return session is not None and lease.session_id == session


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

    Where the owner hands out work by hand, the switch `queue` of the participation
    setting off in that space (as the set `manual` has it), the call is refused
    (`model.QueueOffError`) before it writes anything or releases a lease; an item
    there is taken by its number with `claim_work_item`.

    Choosing and writing are two statements, so the item chosen can be taken by
    somebody else before this claim lands. The guarded write is what catches
    that, and the loser looks for the next candidate instead of being handed an
    item that is already held — which is how two agents asking at once end up
    with two different items. A caller whose own transaction still holds an
    older view keeps seeing the same candidate, so the attempts are bounded and
    the last refusal is reported rather than looped on forever.
    """

    scope = _queue_scope(conn, space, within, label, project)
    settings = participation.load(conn)
    if not settings.on(scope.space_id, "queue"):
        # Before anything is written: the queue that is off releases no lease either.
        key = _space_row(conn, scope.space_id)["key"]
        raise model.QueueOffError(
            f"the owner hands out work in {key} by hand: take the item they named with"
            " claim_work_item"
        )
    holder = calls.holder(author)
    # An expired lease is not a holder, so the queue sees through it: released
    # first, the item then reads unheld to the rule below. A lease in its grace
    # is still held, so the queue neither gives that item nor releases it.
    expire_leases(conn, space_id=scope.space_id)
    # So does work put off until a day that came: the queue reads the space as it is.
    return_due(conn, space_id=scope.space_id)
    lost: model.RevisionConflictError | None = None
    for _ in range(_READY_CLAIM_ATTEMPTS):
        chosen = _next_given(conn, scope)
        if chosen is None:
            return None
        row = read_model.item_by_id(conn, chosen)
        start = _starting(conn, row, settings=settings)
        try:
            _hold(conn, row, holder, start.updates, start.parameters)
        except model.RevisionConflictError as conflict:
            lost = conflict
            continue
        _log(conn, chosen, "claimed", "", author)
        _started(conn, chosen, start, author, "claimed")
        waiting.deliver(conn, row)
        answer = read_model.present(
            conn, read_model.item_by_id(conn, chosen), full=True, settings=settings
        )
        _say_started(conn, answer, start, settings)
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
    reason: object = None,
    gated: bool = False,
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

    Every step the new list leaves out is recorded `checklist_removed` with its
    text, and every step repeated by its `id` with another text with the text it
    had: that wording is gone, and a tick made under it now stands under the new
    one, which the item's close is to name.

    A step repeated by its `id` with a new text may say `clarifies: true`: the
    wording is said better, the meaning stays. Any other step that says it is
    refused, before anything is written.

    `gated` says the write is the caller's own, as a surface takes it, which meets
    the owner's setting: an agent's removal or rewording of a step of a goal or
    stage that does not only clarify it needs `reason`, and is the owner's to make
    where `condition` says `human`. Then the rest of the write is made, those steps
    stay as they stand, and the answer names what waits in `waits_for_owner`
    (`_ask_about_steps`). Left to the agent, the change is marked in the summary of
    decisions, and so is a clarification at any setting. The event of the new list
    reads `<count>`, then `, clarified <positions>` and `: <reason>` when they apply.
    """

    row = _row_for_write(conn, reference, expected_revision)
    existing = model.checklist(row["checklist"])
    items, clarifying = _clarifying(items)
    sent_steps = model.checklist(items)
    # The steps as sent, beside the steps as read; anything but a list (a stored
    # checklist's JSON text) carries nothing new.
    sent = items if isinstance(items, list) else [None] * len(sent_steps)
    by_id = {step["id"]: step for step in existing}
    label = calls.holder(author)
    kept: set[str] = set()
    replacement: list[dict] = []
    completed: list[dict] = []
    reworded: list[_Reworded] = []
    guards: list[str] = []
    for index, (step, raw) in enumerate(zip(sent_steps, sent, strict=True)):
        named = raw.get("id") if isinstance(raw, dict) else None
        clarifies = index in clarifying
        if clarifies and (
            not named or named not in by_id or named in kept or by_id[named]["text"] == step["text"]
        ):
            raise model.PlanningError(
                "[checklist] clarifies marks a step of this item named by its id with a new text"
            )
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
        if match["text"] != step["text"]:
            reworded.append(
                _Reworded(str(match["id"]), str(match["text"]), step["text"], clarifies)
            )
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
    removed = [step for step in existing if step["id"] not in kept]
    changed = [entry for entry in reworded if not entry.clarifies]
    # An agent's own change of a goal's or stage's steps is a point of the owner's setting.
    point = gated and calls.from_agent() and row["kind"] == model.CONTAINER_KIND
    why = _steps_reason(reason, needed=point and bool(removed or changed))
    held = (
        point
        and bool(removed or changed)
        and participation.load(conn).mode(str(row["planning_space_id"]), "condition")
        == participation.HUMAN
    )
    dropped = [step for step in removed if step["done"] or step["claimed_by"]]
    if dropped and not force:
        raise model.PlanningError(
            f"{read_model.reference(conn, row)} would lose {len(dropped)} claimed or completed"
            f" step(s): {'; '.join(step['text'][:80] for step in dropped)}. Send them again,"
            " by their text or id, to keep them, or pass force to discard that state"
            " explicitly"
        )
    identity = str(row["work_item_id"])
    action: pending.Action | None = None
    fresh = False
    if held:
        # Checked as the whole write would be made now, the removals and rewordings are
        # the owner's: the rest is made, and those steps stand as they are.
        action, fresh = pending.hold(
            conn, identity, "condition", _steps_proposal(removed, changed, why, force)
        )
        replacement = _kept_back(existing, replacement, removed, changed)
        removed, changed = [], []
    elif dropped:
        guards.append("checklist_discard")
    for step in completed:
        step["done_by"] = label
        step[model.PREVIOUS_HOLDER] = False
    _keep_held(conn, row, str(row["claim_ref"]), replacement)
    clarified = [entry for entry in reworded if entry.clarifies] if point else []
    detail = _steps_detail(replacement, clarified, why if removed or changed else None)
    replaced = _write_checklist(conn, row, replacement, completed, author, detail=detail)
    for text in (
        *(step["text"] for step in removed),
        *(entry.before for entry in reworded if entry.clarifies or not held),
    ):
        _log(conn, identity, "checklist_removed", str(text)[:120], author)
    said = _steps_what(removed, changed, why) + [entry.said() for entry in clarified]
    if point and said:
        decisions.mark(conn, replaced, "condition", "; ".join(said))
    overridden = record_overrides(conn, identity, guards, author)
    # A step completed or dropped here ends its claim, which may have been the last holder.
    _settle(conn, identity, author, "steps replaced")
    answer = read_model.present(conn, read_model.item_by_id(conn, identity), full=True)
    if overridden:
        answer["overridden"] = overridden
    if action is not None:
        answer["waits_for_owner"] = _ask_about_steps(conn, row, action, fresh, author).answer()
    return answer


@dataclasses.dataclass(frozen=True)
class _Reworded:
    """A step repeated by its id with a new text, and whether it only clarifies it."""

    id: str
    before: str
    after: str
    clarifies: bool

    def said(self) -> str:
        verb = "clarified" if self.clarifies else "rewrote"
        return f"{verb} step «{self.before}» → «{self.after}»"


#: What a step says to only clarify its wording, sent beside its id and new text.
CLARIFIES = "clarifies"
#: The most characters the reason for removing or rewording a step of a goal or stage holds.
STEPS_REASON_LIMIT = 500


def _clarifying(items: object) -> tuple[object, set[int]]:
    """The steps as sent without their `clarifies`, and the positions that said it."""

    if not isinstance(items, list):
        return items, set()
    flagged: set[int] = set()
    stripped: list[object] = []
    for index, raw in enumerate(items):
        if isinstance(raw, dict) and CLARIFIES in raw:
            if not isinstance(raw[CLARIFIES], bool):
                raise model.PlanningError(
                    f"work_item.checklist[{index}].clarifies must be a boolean"
                )
            if raw[CLARIFIES]:
                flagged.add(index)
            raw = {name: value for name, value in raw.items() if name != CLARIFIES}
        stripped.append(raw)
    return stripped, flagged


def _steps_reason(reason: object, *, needed: bool) -> str | None:
    """Why the steps of a goal or stage are removed or reworded; refused where it is needed
    and missing."""

    if reason is None or (isinstance(reason, str) and not reason.strip()):
        if needed:
            raise model.PlanningError(
                "[checklist] removing or rewriting a step of a goal or stage needs checklist_reason"
            )
        return None
    return model.text_field(reason, "checklist_reason", limit=STEPS_REASON_LIMIT)


def _steps_detail(replacement: list[dict], clarified: list[_Reworded], why: str | None) -> str:
    """The detail of `checklist_replaced`: how many steps, which positions only clarify
    their wording, and why steps were removed or reworded."""

    detail = str(len(replacement))
    if clarified:
        named = {entry.id for entry in clarified}
        positions = [str(index) for index, step in enumerate(replacement, 1) if step["id"] in named]
        detail += f", clarified {', '.join(positions)}"
    if why:
        detail += f": {why}"
    return detail[:EVENT_DETAIL_LIMIT]


def _steps_what(removed: list[dict], changed: list[_Reworded], why: str | None) -> list[str]:
    """What the summary of decisions says of steps removed or reworded: each, then why."""

    said = [f"removed step «{step['text']}»" for step in removed]
    said += [entry.said() for entry in changed]
    if said and why:
        said[-1] += f": {why}"
    return said


def _steps_proposal(
    removed: list[dict], changed: list[_Reworded], why: str | None, force: bool
) -> pending.Proposal:
    """The removals and rewordings of steps that wait for the owner, as their action keeps them."""

    return pending.Proposal(
        "checklist",
        {
            "remove": [str(step["id"]) for step in removed],
            "rewrite": [{"id": entry.id, "to": entry.after} for entry in changed],
            "force": force,
        },
        "; ".join(_steps_what(removed, changed, why)),
        reason=why,
        proposed={
            "removed": [{"id": str(step["id"]), "text": str(step["text"])} for step in removed],
            "rewritten": [
                {"id": entry.id, "from": entry.before, "to": entry.after} for entry in changed
            ],
        },
    )


def _kept_back(
    existing: list[dict], replacement: list[dict], removed: list[dict], changed: list[_Reworded]
) -> list[dict]:
    """The new list with the steps the owner is asked about as they stand: a reworded step
    keeps its text, and a removed one stands after the step that stood before it."""

    before = {entry.id: entry.before for entry in changed}
    result = list(replacement)
    for step in result:
        # In place: a step the write completes is the same record, and is recorded as done.
        if step["id"] in before:
            step["text"] = before[step["id"]]
    staying = {str(step["id"]) for step in removed}
    for index, step in enumerate(existing):
        if step["id"] not in staying:
            continue
        placed = {str(found["id"]): at for at, found in enumerate(result)}
        earlier = next(
            (placed[str(old["id"])] for old in reversed(existing[:index]) if old["id"] in placed),
            -1,
        )
        result.insert(earlier + 1, step)
    return result


#: What the owner's question about steps of a goal or stage asks them to do.
_STEPS_ASKED = " Allow it, or keep the steps as they are."


def _ask_about_steps(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    action: pending.Action,
    fresh: bool,
    author: str | None,
) -> pending.Waiting:
    """Ask the owner about the removals and rewordings an agent's write keeps back on a goal
    or stage: what was and what would be, and why (`requests.carry_out`). The same write
    sent again while it waits answers that wait and asks nothing more."""

    if not fresh:
        return pending.Waiting(
            action.id, action.point, pending.owner_question(conn, action), action.what
        )
    reference = read_model.reference(conn, row)
    lines = [f"- remove «{entry['text']}»" for entry in action.proposed["removed"]]
    lines += [f"- «{entry['from']}» → «{entry['to']}»" for entry in action.proposed["rewritten"]]
    prompt = "\n".join(
        [
            f"An agent changes the steps of {reference}, a {_container_word(row)}: {row['title']}.",
            *lines,
            f"Its reason: {action.reason}.{_STEPS_ASKED}",
        ]
    )
    question = pending.ask_owner(
        conn,
        action,
        purpose="condition",
        prompt=prompt[: closing.PROMPT_LIMIT],
        fields=request_model.fields(request_model.condition_fields()),
        author=author,
    )
    return pending.Waiting(action.id, action.point, question, action.what)


def _write_checklist(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    replacement: list[dict],
    completed: list[dict],
    author: str | None,
    *,
    detail: str | None = None,
) -> int:
    """Write the steps and their history: the replacement, then each step it completed.
    The id of the event that records the replacement, whose detail is `detail` or the count."""

    _write(conn, row, ["checklist = ?"], [model.dumps(replacement)])
    identity = str(row["work_item_id"])
    replaced = _log(
        conn,
        identity,
        "checklist_replaced",
        str(len(replacement)) if detail is None else detail,
        author,
    )
    for step in completed:
        _log(conn, identity, "checklist_completed", step["text"][:120], author)
    return replaced


def record_overrides(
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
    settings = participation.load(conn)
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
            start = _starting(conn, row, settings=settings)
    else:
        _keep_held(conn, row, str(row["claim_ref"]), steps)
    _write(conn, row, ["checklist = ?", *start.updates], [model.dumps(steps), *start.parameters])
    identity = str(row["work_item_id"])
    _log(conn, identity, action, step["text"][:120], author)
    _started(conn, identity, start, author, "claimed")
    if not release:
        waiting.deliver(conn, row)
    overridden = record_overrides(conn, identity, carried, author)
    requeued = _settle(conn, identity, author, "released") if release else None
    answer = read_model.present(
        conn, read_model.item_by_id(conn, identity), full=True, settings=settings
    )
    _say_started(conn, answer, start, settings)
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
    overridden = record_overrides(conn, identity, ["checklist_claim"] if theirs else [], author)
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


@_marked
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
    attached commits, the links in their own direction, and the projects, a
    project more than one of them names keeping its strongest source — and each
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
    overridden = held_elsewhere(conn, [survivor, *merged], author, force)
    spoke = _merge_spoke(conn, merged, force)
    steps = model.checklist(survivor["checklist"])
    moving = [model.checklist(row["checklist"]) for row in merged]
    total = len(steps) + sum(len(found) for found in moving)
    if total > model.MAX_CHECKLIST:
        raise model.PlanningError(
            f"{read_model.reference(conn, survivor)} would hold {total} checklist steps;"
            f" a checklist holds at most {model.MAX_CHECKLIST}"
        )
    cancels = []
    for row in merged:
        target = states.cancel_state(conn, row)
        if target is None:
            raise model.PlanningError(
                f"{read_model.reference(conn, row)} cannot close as a duplicate: its workflow"
                " has no cancelled state it can move to"
            )
        cancels.append(target)
    note = model.text_field(reason, "reason", limit=512, required=False)
    conn.execute("SAVEPOINT planning_merge")
    try:
        answer = _fold(
            conn,
            survivor,
            steps,
            list(zip(merged, moving, cancels, strict=True)),
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


def held_elsewhere(
    conn: sqlite3.Connection,
    rows: list[sqlite3.Row],
    author: str | None,
    force: bool,
    *,
    doing: str = "merge it",
) -> dict[str, str]:
    """The claims of other sessions a write would override, by item id; refused without `force`.

    Moving steps into an item someone else holds changes their work, and closing
    an item someone else holds ends it, so a merge needs `force`, and so does an
    action that takes the item from its holder's work (`split`). `doing` says what
    `force` would do anyway, in the refusal. An abandoned lease (`leases.abandoned`)
    is nobody's work any more and does not stand in the way.
    """

    actor = model.actor(author)
    caller = calls.current()
    overridden: dict[str, str] = {}
    settings = participation.load(conn)
    for row in rows:
        lease = leases.lease(conn, row, settings=settings)
        if lease is None or leases.abandoned(lease) or leases.held_by(lease, caller, actor):
            continue
        if not force:
            raise model.PlanningError(
                f"{read_model.reference(conn, row)} is held by {lease.holder};"
                f" pass force to {doing} anyway"
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
        record_overrides(conn, survivor_id, ["claim"], author)
        forced.append(f"{survivor_ref}: claim")
    for row, found, target in merging:
        identity = str(row["work_item_id"])
        reference = read_model.reference(conn, row)
        # A write that waited for the owner was about this item, not the survivor: it is
        # dropped before the questions move, and its questions end here as cancelled.
        pending.drop_on(
            conn,
            identity,
            f"merged into {survivor_ref}",
            reason=questions.closed_reason("cancelled"),
            author=author,
        )
        # Only a question to the owner is said to wait on the survivor: a list waits for
        # nobody, and a request asked of an agent session waits for that session.
        waiting_on = conn.execute(
            _OWNER_QUESTIONS_ON,
            (identity,),
        ).fetchone()[0]
        roots = _moving_roots(conn, identity)
        # The question was about the work, and the work moves. Left here a pending
        # one would end with this item, and its answer would stay on a closed one.
        # A request asked of an agent session is about the work too, and moves with it.
        # A list goes with the comment it stands under, so a report's stays here, and
        # the questions of a dropped action stay with the action.
        conn.execute(
            "UPDATE work_item_requests SET work_item_id = ? WHERE work_item_id = ?"
            " AND action_id IS NULL"
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
            "commits": _move_commits(conn, identity, survivor_id),
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
            record_overrides(conn, identity, ["claim"], author)
            forced.append(f"{reference}: claim")
        summary = {
            "done": f"Merged into {survivor_ref}, which now holds its {_counts(moved)}.",
            "next": f"Continue in {survivor_ref}.",
        }
        if note:
            summary["why"] = note
        set_summary(conn, identity, summary, author=author)
        # What was put off until it waits for the survivor, which holds its work now,
        # before its close would bring that back.
        deferral.repoint(conn, identity, survivor_id, involved)
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
            record_overrides(conn, identity, ["person_spoke"], author)
            forced.append(f"{reference}: person_spoke")
        parent = row["parent_id"]
        if parent and parent not in (survivor["parent_id"], survivor_id):
            warnings.append(
                f"{reference} stays under"
                f" {read_model.reference(conn, read_model.item_by_id(conn, str(parent)))};"
                f" {survivor_ref} keeps its own parent"
            )
        if waiting_on:
            warnings.append(
                f"{reference}'s {waiting_on} pending request(s) now wait on {survivor_ref}"
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


def _move_commits(conn: sqlite3.Connection, identity: str, survivor_id: str) -> int:
    """Move a merged item's attached commits to the survivor; how many moved.

    One the survivor has already stays there as it was, and the merged item's
    attachment of it goes: a commit is attached to an item once. The projects
    those commits gave move with the item's projects, so each project the
    survivor holds by its commits still has one of them.
    """

    moved = conn.execute(
        "UPDATE OR IGNORE work_item_commits SET work_item_id = ? WHERE work_item_id = ?",
        (survivor_id, identity),
    ).rowcount
    conn.execute("DELETE FROM work_item_commits WHERE work_item_id = ?", (identity,))
    return int(moved)


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
    """`2 steps, 1 comment, 0 refs, 3 commits and 1 link`."""

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
) -> int:
    """Write one history event, and answer its id; `limit` is raised only for a detail
    this module composes."""

    inserted = conn.execute(
        "INSERT INTO work_item_events(work_item_id,action,detail,author,call_id) VALUES(?,?,?,?,?)",
        (
            work_item_id,
            model.event_action(action),
            model.text_field(detail, "event.detail", limit=limit, required=False),
            model.actor(author),
            calls.call_id(conn, work_item_id),
        ),
    )
    return int(inserted.lastrowid or 0)


def _step(steps: list[dict], item_id: object, conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
    wanted = model.identifier(item_id, "checklist item id")
    for step in steps:
        if step["id"] == wanted:
            return step
    raise model.PlanningError(f"{read_model.reference(conn, row)} has no checklist step {wanted}")
