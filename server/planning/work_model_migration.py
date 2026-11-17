"""Planning's part of the migration that carries a store Valkama 2.9 left to the work model.

The store's rows meant the old model: seven categories with `backlog` and `queued`,
an `epic` kind, and claims nothing ever cleared on closed work. The steps below
give them the work model's meaning, in one transaction `store.migrate_work_model`
opens with foreign keys off, since rebuilding a table others reference would
otherwise cascade into them:

- **oracle** reads, before any write, what every later check compares against: the
  rows of every table, each item's kind, place, acceptance and start as the rules
  below give them, who last held each closed item, what each accepted open
  container derives, and the indexes and triggers of `workflow_states` and
  `work_items`, which `states` and `items` rebuild. `items` rebuilds the events
  table and `sessions` as well; `fresh-shape` holds every table to a fresh store.
- **states** gives every workflow the eight categories: `backlog` becomes `triage` and
  `queued` becomes `ready`, a default key and name follow, a Deferred state comes
  right after triage and a service state last, each reachable from and to every
  other state.
- **history** renames those keys in the history, only where a key stands.
- **items** rebuilds `work_items`: an epic, or any item with children, becomes a
  container; accepted work gets the basis `migrated`; a task gets the time its work
  started. The events table takes the new actions. `sessions` is rebuilt to the
  fresh declaration when the Board cutover left it another: that cutover renamed
  `card_id` to `work_item_id` and kept its type `INTEGER`.
- **containers** clears every claim on a container and puts each accepted open one in the
  service state; **task-holders** clears every claim on a task that is not active or blocked,
  and gives an active task nobody holds back to ready; **children-left** takes each open child
  out of a closed container into triage.
- **checks** creates the trigger that keeps every kind where it may stand.
- **item-projects** creates the table of the projects each item changes, and the two triggers
  through which a project gained or lost marks its item for the word index, and
  fills it: a task the file `valkama projects map-items` wrote holds projects for
  gets them, every other task its space's former project, `migrated`; a container
  none. The file is the one `store` checked before the first write and left in
  `Context.memo`, beside the registry it read.
- **labels** takes off each item the labels its entry in that file drops, the
  others in their order, and brings the word index current inside the transaction:
  `item-projects` and the labels marked items stale, and `indexes` reads the index.
- **spaces** rebuilds `planning_spaces` without the project each space held and
  with the place an agent launched from one of its cards works, `space` for each.
  `item-projects` has read that project, which the registry now binds to the
  space. A name becomes the space's alone: no two spaces share one, as `store`
  checked before the first write.
- **last-route** drops the last route the shell remembered when its scope is a project:
  a space is the scope now, and the address it names no longer opens.
- **addressee** appends the column a request names the agent session it asks with
  (`work_item_requests.addressee`) and its index; every request it finds asks the
  owner, as it did.
- **waiting-words** creates the table of the words a person left on a goal or stage that no
  session heard (`work_item_waiting_notices`) and its two indexes. It starts empty:
  which of a person's acts before 3.0 nobody heard cannot be known now.
- **ended-requests** rebuilds `work_item_requests` from the fresh declaration, with the `purpose`
  a question to the owner may carry and the reasons a close stores: a request still
  pending on a closed item, which 2.9 read `task_closed` and left pending, ends
  `expired` as `item_completed` or `item_cancelled` by the category its item stands
  in, with no event, as does one that stored `task_closed`. One that had already
  lapsed, past its deadline or on an execution that ended, ends as it lapsed,
  `deadline` or `execution_closed`.

Every write is recorded the way the service records it, under one author, at the
moment of the migration and with no call: `released` and `checklist_released` for a
claim cleared, `opened` for a container entering the service state, `transitioned`
for a task moved, `child_left` on the container a child left. No `accepted` is
written: nobody recorded an acceptance before this, and `migrated` says exactly that.

The postconditions `fresh-shape` to `second-run` and `store-identity` to `requests-ended` are checked after the steps, inside the
same transaction, `second-run` last; `store` adds `recovery-point`, the recovery point. `row-counts` compares the
row counts of the tables `oracle` counted and of the projects `item-projects` fills; `fresh-tables` holds every
other table to being empty and declared by a fresh store.
"""

from __future__ import annotations

import json
import re
import sqlite3
from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from .. import store_steps
from ..store_steps import Context, Postcondition, Step, UnmetError
from . import item_tree, model, questions, read_model, words, work_model_probes
from . import store as planning_store

#: Who every record the migration writes names as its author.
AUTHOR = "work-model migration"
#: The detail of an `opened` and the reason of a `transitioned` the migration writes.
REASON = "3.0 migration"
#: Why a child left a container that was closed with it still open.
CHILD_LEFT_REASON = "closed before 3.0"

_SERVICE = model.SERVICE_CATEGORY
_CONTAINER = model.CONTAINER_KIND
#: The old categories and the ones that replace them.
_RENAMED_CATEGORIES = {"backlog": "triage", "queued": "ready"}
#: A default key and name the work model renames, by the category it stands in now.
_RENAMED_DEFAULTS = (
    ("triage", "backlog", "Backlog", "triage", "Triage"),
    ("ready", "todo", "Todo", "ready", "Ready"),
)
#: The default workflow of every build before the work model, key by category.
_OLD_DEFAULT = {
    "backlog": "backlog",
    "todo": "queued",
    "dev": "active",
    "review": "review",
    "done": "completed",
    "blocked": "blocked",
    "cancelled": "cancelled",
}
_DEFERRED = next(state for state in model.DEFAULT_STATES if state[2] == "deferred")
_SERVICE_STATE = next(state for state in model.DEFAULT_STATES if state[2] == _SERVICE)
#: Standing in one of these, ever, is what accepted work: the old names, then the new.
_ACCEPTING_OLD = frozenset({"queued", "active", "review", "blocked", "completed"})
_ACCEPTING = frozenset({"ready", "active", "review", "blocked", "completed"})
#: Entering one of these, or being claimed, is what started a task.
_STARTING = frozenset({"active", "review", "completed"})
_HELD = frozenset({"active", "blocked"})


def _sql_set(values: Iterable[str]) -> str:
    return ",".join(f"'{value}'" for value in sorted(values))


# -- the records the history holds ---------------------------------------------

#: The source of a project a task took from its space because nothing else named one.
_MIGRATED = "migrated"

_KEY = r"[a-z][a-z0-9-]{0,31}"
#: The three forms a `created` or `transitioned` record has: `<key>`,
#: `<key>: <reason>`, and the Board era's `<key> -> <key>`.
_ENTRY = re.compile(
    rf"(?P<source>{_KEY}) -> (?P<target>{_KEY})|(?P<key>{_KEY})(?P<reason>: .*)?", re.S
)

#: The key a record names as the state entered, in SQL: what stands before `: ` in
#: a record with a reason, after ` -> ` in a move, or the whole detail. Written
#: apart from `_ENTRY` on purpose, so the oracle and the steps read the history two
#: ways and the postconditions compare them.
_ENTERED_SQL = """CASE
    WHEN instr(e.detail, ': ') > 0
     AND (instr(e.detail, ' -> ') = 0 OR instr(e.detail, ': ') < instr(e.detail, ' -> '))
    THEN substr(e.detail, 1, instr(e.detail, ': ') - 1)
    WHEN instr(e.detail, ' -> ') > 0 THEN substr(e.detail, instr(e.detail, ' -> ') + 4)
    ELSE e.detail END"""


def _keys(detail: str) -> list[str] | None:
    """The keys a record names where a key stands, entered last; None for another form."""

    found = _ENTRY.fullmatch(detail)
    if found is None:
        return None
    if found["source"] is not None:
        return [found["source"], found["target"]]
    return [found["key"]]


def _renamed(detail: str, renames: Mapping[str, str]) -> str | None:
    """A record with each renamed key replaced where a key stands, or None when none is."""

    found = _ENTRY.fullmatch(detail)
    if found is None:
        return None
    if found["source"] is not None:
        source = renames.get(found["source"], found["source"])
        target = renames.get(found["target"], found["target"])
        changed = f"{source} -> {target}"
    else:
        changed = renames.get(found["key"], found["key"]) + (found["reason"] or "")
    return changed if changed != detail else None


# -- writes the steps share ----------------------------------------------------


def _log(conn: sqlite3.Connection, context: Context, item: str, action: str, detail: str) -> None:
    conn.execute(
        "INSERT INTO work_item_events(work_item_id,action,detail,author,created_at,call_id)"
        " VALUES(?,?,?,?,?,NULL)",
        (item, action, detail, AUTHOR, context.now),
    )
    context.memo.setdefault("written", Counter())[action] += 1


def _claimed_steps(checklist: str) -> list[dict]:
    steps = json.loads(checklist or "[]")
    return [step for step in steps if isinstance(step, dict) and step.get("claimed_by")]


def _release(conn: sqlite3.Connection, context: Context, item: str) -> bool:
    """End every claim on one item, as a close does: the holder and each step named."""

    row = conn.execute(
        "SELECT claim_ref, claim_call_id, checklist FROM work_items WHERE work_item_id = ?",
        (item,),
    ).fetchone()
    steps = json.loads(row["checklist"] or "[]")
    claimed = [step for step in steps if isinstance(step, dict) and step.get("claimed_by")]
    if not row["claim_ref"] and row["claim_call_id"] is None and not claimed:
        return False
    for step in claimed:
        step["claimed_by"] = ""
    conn.execute(
        "UPDATE work_items SET claim_ref = '', claim_call_id = NULL, checklist = ?"
        " WHERE work_item_id = ?",
        (model.dumps(steps) if claimed else row["checklist"], item),
    )
    if row["claim_ref"]:
        _log(conn, context, item, "released", str(row["claim_ref"]))
    for step in claimed:
        _log(conn, context, item, "checklist_released", str(step.get("text", ""))[:120])
    return True


def _first_reachable(conn: sqlite3.Connection, state_id: str, category: str) -> sqlite3.Row | None:
    """The first state of `category` in workflow order that the workflow lets an item
    standing in `state_id` reach: where the server places work it moves."""

    found: sqlite3.Row | None = conn.execute(
        "SELECT s.* FROM workflow_states s JOIN workflow_transitions t"
        " ON t.workflow_id = s.workflow_id AND t.to_state_id = s.state_id"
        " WHERE t.from_state_id = ? AND s.category = ? ORDER BY s.position LIMIT 1",
        (state_id, category),
    ).fetchone()
    return found


def _move(
    conn: sqlite3.Connection, context: Context, item: sqlite3.Row, category: str, reference: str
) -> None:
    target = _first_reachable(conn, str(item["state_id"]), category)
    if target is None:
        raise RuntimeError(f"{reference} reaches no {category} state in its workflow")
    conn.execute(
        "UPDATE work_items SET state_id = ? WHERE work_item_id = ?",
        (target["state_id"], item["work_item_id"]),
    )
    _log(conn, context, str(item["work_item_id"]), "transitioned", f"{target['key']}: {REASON}")


def _references(conn: sqlite3.Connection) -> dict[str, str]:
    return {
        str(row[0]): f"{row[1]}-{row[2]}"
        for row in conn.execute(
            "SELECT w.work_item_id, p.key, w.number FROM work_items w"
            " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
        )
    }


# -- the oracle ----------------------------------------------------------------


@dataclass
class Oracle:
    """What the store must hold after the steps, read before the first write."""

    counts: dict[str, int] = field(default_factory=dict)
    workflows: dict[str, dict[str, Any]] = field(default_factory=dict)
    expect: dict[str, dict[str, Any]] = field(default_factory=dict)
    closings: dict[str, tuple[str | None, str | None]] = field(default_factory=dict)
    derived: dict[str, str] = field(default_factory=dict)
    objects: dict[str, list[str]] = field(default_factory=dict)
    events: Counter[str] = field(default_factory=Counter)
    releases: Counter[tuple[str, str, str]] = field(default_factory=Counter)
    rewrites: int = 0
    last_event: int = 0
    moved: list[dict[str, str]] = field(default_factory=list)
    review: list[str] = field(default_factory=list)
    search: dict[str, list[str] | None] = field(default_factory=dict)
    content: dict[str, dict[str, Any]] = field(default_factory=dict)
    numbers: set[tuple[str, int]] = field(default_factory=set)
    request_ids: frozenset[str] = frozenset()
    #: Each request's item, kind and status, and the reason `ended-requests` ends it with, by id:
    #: the close's for one still waiting on a closed item or one that stored
    #: `task_closed`, and its lapse's for one pending there that had lapsed.
    requests: dict[str, tuple[str, str, str]] = field(default_factory=dict)
    ended: dict[str, str] = field(default_factory=dict)
    lapsed: dict[str, str] = field(default_factory=dict)
    containers: int = 0
    started_from_created: int = 0
    #: The rows `item-projects` leaves in `work_item_projects`, a table the store `oracle`
    #: reads lacks, and each task's set of them; a container has none.
    item_projects: int = 0
    projects: dict[str, set[tuple[str, str]]] = field(default_factory=dict)
    #: Each item's labels after `items` and `labels`, and the items whose labels `labels` changes.
    labels_after: dict[str, list[str]] = field(default_factory=dict)
    labels_dropped: set[str] = field(default_factory=set)
    #: For each stem searched, the tasks a word of one of their projects' ids starts
    #: with it: what the search finds after the migration besides what it found before.
    search_added: dict[str, list[str]] = field(default_factory=dict)
    #: Every remembered preference, record by key, and the keys `last-route` drops.
    ui_prefs: dict[str, str] = field(default_factory=dict)
    dropped_prefs: list[str] = field(default_factory=list)
    #: The store's identity and each space as `spaces` keeps it: id, key, name, next number.
    data_scope_id: str = ""
    spaces: set[tuple[str, str, str, int]] = field(default_factory=set)


def _oracle(context: Context) -> Oracle:
    found = context.memo.get("oracle")
    if not isinstance(found, Oracle):
        raise UnmetError("the oracle was not read before the steps")
    return found


#: The tables FTS5 keeps the word index in, which the word index's own name begins.
#: Its stale marks are a plain table of the store's and are not among them.
_INDEX_SHADOWS = f"{words.INDEX}_"


def _tables(conn: sqlite3.Connection) -> list[str]:
    """Every table whose rows count. The word index is derived from the rows of the
    others and is held to them by `indexes`, so neither it nor the tables FTS5 keeps it in
    are counted: bringing it current in `labels` changes how many rows those hold."""

    return [
        str(row[0])
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
            " AND substr(name, 1, 7) != 'sqlite_' AND sql NOT LIKE 'CREATE VIRTUAL%'"
            " AND (substr(name, 1, ?) != ? OR name = ?) ORDER BY name",
            (len(_INDEX_SHADOWS), _INDEX_SHADOWS, words.ROWS),
        )
    ]


def _counts(conn: sqlite3.Connection) -> dict[str, int]:
    return {
        table: int(conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])  # noqa: S608
        for table in _tables(conn)
    }


def _objects(conn: sqlite3.Connection) -> dict[str, list[str]]:
    names: dict[str, list[str]] = {"work_items": [], "workflow_states": []}
    for table, name in conn.execute(
        "SELECT tbl_name, name FROM sqlite_master WHERE type IN ('index','trigger')"
        " AND tbl_name IN ('work_items','workflow_states') ORDER BY name"
    ):
        names[str(table)].append(str(name))
    return names


def _search_queries(conn: sqlite3.Connection, projects: Iterable[str]) -> list[str]:
    """A few words from the items' titles, and the stem of every word of the ids of
    the projects `item-projects` gives: the words a search finds an item by when `labels` has taken
    the labels that held them."""

    queries: list[str] = []
    for (title,) in conn.execute("SELECT title FROM work_items ORDER BY work_item_id LIMIT 40"):
        for stem in words.stems(str(title), shortest=3)[:1]:
            if stem not in queries:
                queries.append(stem)
    queries = queries[:12]
    for project in sorted(projects):
        for term in words.terms(project):
            if term[: words.STEM] not in queries:
                queries.append(term[: words.STEM])
    return queries


def _search(conn: sqlite3.Connection, queries: Iterable[str]) -> dict[str, list[str] | None]:
    """What a search for each stem finds, by item id; None where the index cannot be read."""

    found: dict[str, list[str] | None] = {}
    for stem in queries:
        rows = words.search_rows(conn, [stem], space_id=None, limit=100_000, offset=0)
        found[stem] = None if rows is None else sorted(str(row["work_item_id"]) for row in rows)
    return found


#: What each accepted open container derives, read from the history of the store
#: as it was: a task under it started when it was claimed or entered work, and a
#: closed container's open child, which `children-left` takes out, is not under it any more.
_DERIVED_BEFORE = f"""
WITH RECURSIVE
entries AS (
    SELECT e.work_item_id AS item, s.category AS category
    FROM work_item_events e
    JOIN work_items w ON w.work_item_id = e.work_item_id
    JOIN workflow_states s ON s.workflow_id = w.workflow_id AND s.key = {_ENTERED_SQL}
    WHERE e.action IN ('created', 'transitioned')
),
started(item) AS (
    SELECT item FROM entries WHERE category IN ({_sql_set(_STARTING)})
    UNION SELECT work_item_id FROM work_item_events WHERE action IN ('claimed', 'taken_over')
    UNION SELECT w.work_item_id FROM work_items w
        JOIN workflow_states s ON s.state_id = w.state_id
        WHERE s.category IN ({_sql_set(_STARTING)})
),
holders(item) AS (
    SELECT work_item_id FROM work_items WHERE kind = 'epic'
    UNION SELECT parent_id FROM work_items WHERE parent_id IS NOT NULL
),
kept(parent, child) AS (
    SELECT c.parent_id, c.work_item_id FROM work_items c
    JOIN workflow_states cs ON cs.state_id = c.state_id
    JOIN work_items p ON p.work_item_id = c.parent_id
    JOIN workflow_states ps ON ps.state_id = p.state_id
    WHERE NOT (ps.is_terminal = 1 AND cs.is_terminal = 0)
),
under(root, item) AS (
    SELECT k.parent, k.child FROM kept k JOIN json_each(?) r ON r.value = k.parent
    UNION SELECT u.root, k.child FROM under u JOIN kept k ON k.parent = u.item
)
SELECT r.value,
    EXISTS (SELECT 1 FROM kept k WHERE k.parent = r.value),
    EXISTS (SELECT 1 FROM kept k JOIN work_items c ON c.work_item_id = k.child
            JOIN workflow_states s ON s.state_id = c.state_id
            WHERE k.parent = r.value AND s.is_terminal = 0),
    EXISTS (SELECT 1 FROM under u WHERE u.root = r.value
            AND u.item IN (SELECT item FROM started)
            AND u.item NOT IN (SELECT item FROM holders))
FROM json_each(?) r
"""  # noqa: S608 - the model's own category names, no value

#: The same, read from the migrated store: the start each task records, the
#: children it has now, and the ones that left.
_DERIVED_AFTER = """
WITH RECURSIVE under(root, item) AS (
    SELECT r.value, w.work_item_id FROM json_each(?) r JOIN work_items w ON w.parent_id = r.value
    UNION SELECT u.root, w.work_item_id FROM under u JOIN work_items w ON w.parent_id = u.item
)
SELECT r.value,
    EXISTS (SELECT 1 FROM work_items c WHERE c.parent_id = r.value)
        OR EXISTS (SELECT 1 FROM work_item_events e
                   WHERE e.work_item_id = r.value AND e.action = 'child_left'),
    EXISTS (SELECT 1 FROM work_items c JOIN workflow_states s ON s.state_id = c.state_id
            WHERE c.parent_id = r.value AND s.category NOT IN ('completed', 'cancelled')),
    EXISTS (SELECT 1 FROM under u JOIN work_items w ON w.work_item_id = u.item
            WHERE u.root = r.value AND w.started_at IS NOT NULL)
FROM json_each(?) r
"""


def _derive(had_children: object, any_open: object, any_started: object) -> str:
    if not had_children:
        return "not_started"
    if not any_open:
        return "awaiting_confirmation"
    return "in_progress" if any_started else "not_started"


def _derived(conn: sqlite3.Connection, query: str, containers: Iterable[str]) -> dict[str, str]:
    identities = json.dumps(sorted(containers))
    return {
        str(row[0]): _derive(row[1], row[2], row[3])
        for row in conn.execute(query, (identities, identities))
    }


def _read_requests(
    conn: sqlite3.Connection, oracle: Oracle, states: Mapping[str, sqlite3.Row], at: str
) -> None:
    """The oracle's reading of the requests `ended-requests` ends, in Python: every
    pending one, and every one that stored `task_closed`, on an item standing in a
    state that closes it. A pending one that has lapsed at `at`, as the service reads a
    lapse (`questions.lapse`), ends as it lapsed; the others as their item closed."""

    places = {
        str(row[0]): states.get(str(row[1]))
        for row in conn.execute("SELECT work_item_id, state_id FROM work_items")
    }
    for row in conn.execute(
        "SELECT r.request_id, r.work_item_id, r.kind, r.status, r.expired_reason,"
        " r.expires_at, r.execution_id, x.execution_id IS NOT NULL AS execution_found,"
        " x.ended_at AS execution_ended_at, x.status AS execution_status"
        " FROM work_item_requests r LEFT JOIN executions x ON x.execution_id = r.execution_id"
    ):
        identity = str(row["request_id"])
        oracle.requests[identity] = (str(row["work_item_id"]), str(row["kind"]), str(row["status"]))
        state = places.get(str(row["work_item_id"]))
        if state is None or not state["is_terminal"]:
            continue
        lapsed = questions.lapse(row, at) if row["status"] == "pending" else None
        if lapsed is not None:
            oracle.lapsed[identity] = lapsed
        elif row["status"] == "pending" or row["expired_reason"] == "task_closed":
            oracle.ended[identity] = questions.closed_reason(str(state["category"]))


def _read_oracle(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    """`oracle`: what the migrated store must hold, read from the store before any write.

    The rules are applied here in Python to the rows as they are, and in the steps
    in SQL to the rows as `states` and `history` left them, so a postcondition compares two
    readings of one rule rather than a reading with itself.
    """

    oracle = Oracle(counts=_counts(conn), objects=_objects(conn))
    oracle.request_ids = frozenset(
        str(row[0]) for row in conn.execute("SELECT request_id FROM work_item_requests")
    )
    oracle.last_event = int(
        conn.execute("SELECT coalesce(MAX(id), 0) FROM work_item_events").fetchone()[0]
    )
    states = {
        str(row["state_id"]): row
        for row in conn.execute("SELECT * FROM workflow_states ORDER BY workflow_id, position")
    }
    by_workflow: dict[str, list[sqlite3.Row]] = {}
    for state in states.values():
        by_workflow.setdefault(str(state["workflow_id"]), []).append(state)
    moves: dict[str, set[str]] = {}
    for source, target in conn.execute(
        "SELECT from_state_id, to_state_id FROM workflow_transitions"
    ):
        moves.setdefault(str(source), set()).add(str(target))
    renames: dict[str, dict[str, str]] = {}
    for workflow, listed in by_workflow.items():
        keys = {str(state["key"]): state for state in listed}
        categories = {str(state["category"]) for state in listed}
        count = len(listed)
        adds_deferred = "deferred" not in categories
        adds_service = _SERVICE not in categories
        oracle.workflows[workflow] = {
            "states": count,
            "adds": int(adds_deferred) + int(adds_service),
            "transitions": 2 * count * int(adds_deferred)
            + 2 * (count + int(adds_deferred)) * int(adds_service),
            "standard": {key: str(state["category"]) for key, state in keys.items()}
            == _OLD_DEFAULT,
        }
        renamed = {}
        for _, old_key, _, new_key, _ in _RENAMED_DEFAULTS:
            old = keys.get(old_key)
            if old is not None and _OLD_DEFAULT[old_key] == old["category"] and new_key not in keys:
                renamed[old_key] = new_key
        if renamed:
            renames[workflow] = renamed
        for state in listed:
            oracle.workflows[workflow].setdefault("keys", {})[str(state["key"])] = state

    items = {str(row["work_item_id"]): row for row in conn.execute("SELECT * FROM work_items")}
    references = _references(conn)
    children: dict[str, list[str]] = {}
    for identity, row in items.items():
        if row["parent_id"] is not None:
            children.setdefault(str(row["parent_id"]), []).append(identity)
    stood: dict[str, str] = {}
    began: dict[str, str] = {}
    for row in conn.execute(
        "SELECT work_item_id, action, detail, created_at FROM work_item_events"
        " WHERE action IN ('created','transitioned','claimed','taken_over') ORDER BY id"
    ):
        identity, at = str(row["work_item_id"]), str(row["created_at"])
        item = items.get(identity)
        if item is None:
            continue
        if row["action"] in ("claimed", "taken_over"):
            began[identity] = min(began.get(identity, at), at)
            continue
        named = _keys(str(row["detail"]))
        if named is None:
            continue
        renamed = renames.get(str(item["workflow_id"]), {})
        if any(key in renamed for key in named):
            oracle.rewrites += 1
        entered = oracle.workflows[str(item["workflow_id"])]["keys"].get(named[-1])
        if entered is None:
            continue
        category = str(entered["category"])
        if category in _ACCEPTING_OLD:
            stood[identity] = min(stood.get(identity, at), at)
        if category in _STARTING:
            began[identity] = min(began.get(identity, at), at)

    def old_category(identity: str) -> str:
        return str(states[str(items[identity]["state_id"])]["category"])

    def has_stood(identity: str) -> bool:
        return identity in stood or old_category(identity) in _ACCEPTING_OLD

    expect = oracle.expect
    for identity, row in items.items():
        container = row["kind"] == "epic" or identity in children
        category = old_category(identity)
        if container:
            accepted = has_stood(identity) or any(has_stood(c) for c in children.get(identity, []))
            times = [stood[i] for i in (identity, *children.get(identity, [])) if i in stood]
        else:
            accepted = has_stood(identity) and category != "backlog"
            times = [stood[identity]] if identity in stood else []
        started = None
        if not container:
            started = began.get(identity)
            if started is None and category in _STARTING:
                started = str(row["created_at"])
                oracle.started_from_created += 1
        labels = json.loads(row["labels"] or "[]")
        kind_label = (
            container and row["kind"] in ("bug", "improvement") and row["kind"] not in labels
        )
        if kind_label:
            labels = [*labels, row["kind"]]
        expect[identity] = {
            "container": container,
            "state": str(row["state_id"]),
            "category": _RENAMED_CATEGORIES.get(category, category),
            "terminal": bool(states[str(row["state_id"])]["is_terminal"]),
            "accepted": accepted,
            "accepted_at": (min(times) if times else str(row["created_at"])) if accepted else None,
            "started_at": started,
            "parent": row["parent_id"],
            "claim": str(row["claim_ref"]),
            "call": row["claim_call_id"],
            "steps": [str(step.get("text", ""))[:120] for step in _claimed_steps(row["checklist"])],
            "labels": labels,
        }
        oracle.containers += int(container)
        oracle.content[identity] = {
            "title": row["title"],
            "description": row["description"],
            "checklist": row["checklist"],
            # Set by `release` below: whether `containers` to `children-left` clear this
            # item's step claims.
            "steps_released": False,
            "labels": row["labels"],
            # Whether `items` adds the kind label, writing the labels anew.
            "kind_label": kind_label,
            "summary": row["summary"],
        }
        oracle.numbers.add((str(row["planning_space_id"]), int(row["number"])))

    def first(identity: str, category: str) -> str | None:
        """Where a move by the server lands: the first state of the category the item
        can reach, the service state reaching every state."""

        here = expect[identity]["state"]
        workflow = str(items[identity]["workflow_id"])
        reachable = (
            {str(state["state_id"]) for state in by_workflow[workflow]}
            if here == _SERVICE
            else moves.get(here, set())
        )
        landing = [
            states[state]
            for state in reachable
            if state in states
            and _RENAMED_CATEGORIES.get(
                str(states[state]["category"]), str(states[state]["category"])
            )
            == category
        ]
        return (
            str(min(landing, key=lambda state: state["position"])["state_id"]) if landing else None
        )

    def release(identity: str) -> None:
        found = expect[identity]
        if found["claim"]:
            oracle.releases[(identity, "released", found["claim"])] += 1
            oracle.events["released"] += 1
        if found["steps"]:
            oracle.content[identity]["steps_released"] = True
        for text in found["steps"]:
            oracle.releases[(identity, "checklist_released", text)] += 1
            oracle.events["checklist_released"] += 1
        found.update(claim="", call=None, steps=[])

    def place(identity: str, category: str) -> None:
        landing = first(identity, category)
        if landing is not None:
            expect[identity].update(state=landing, category=category)
        oracle.events["transitioned"] += 1

    # `containers`, `task-holders` and `children-left` in the order the steps take them.
    for identity, found in expect.items():
        if found["container"]:
            release(identity)
            if found["accepted"] and not found["terminal"]:
                found.update(state=_SERVICE, category=_SERVICE)
                oracle.events["opened"] += 1
    for identity, found in expect.items():
        if found["container"]:
            continue
        if found["category"] not in _HELD:
            release(identity)
        elif found["category"] == "active" and not found["claim"] and not found["steps"]:
            place(identity, "ready")
    for identity, found in sorted(expect.items()):
        parent = found["parent"]
        if parent is None or not expect[str(parent)]["terminal"] or found["terminal"]:
            continue
        if found["category"] != "triage":
            place(identity, "triage")
        found.update(parent=None, accepted=False, accepted_at=None)
        release(identity)
        oracle.events["child_left"] += 1
        oracle.moved.append({"reference": references[identity], "from": references[str(parent)]})
    oracle.moved.sort(key=lambda moved: (moved["from"], moved["reference"]))
    oracle.review = sorted(
        references[identity] for identity, found in expect.items() if found["category"] == "review"
    )
    closed = [row for identity, row in items.items() if expect[identity]["terminal"]]
    oracle.closings = read_model.closings(conn, closed)
    oracle.derived = _derived(
        conn,
        _DERIVED_BEFORE,
        [identity for identity, found in expect.items() if found["category"] == _SERVICE],
    )
    _read_item_projects(conn, context, oracle)
    oracle.ui_prefs = {
        str(key): str(record)
        for key, record in conn.execute("SELECT key, record_json FROM platform_ui_prefs")
    }
    oracle.dropped_prefs = sorted(
        key
        for key, record in oracle.ui_prefs.items()
        if key == _LAST_ROUTE and _project_scoped(record)
    )
    oracle.data_scope_id = _data_scope_id(conn)
    oracle.spaces = _spaces(conn)
    _read_requests(conn, oracle, states, context.now)
    context.memo["oracle"] = oracle
    context.memo["renames"] = renames
    return {
        "tables": oracle.counts,
        "items": len(items),
        "containers": oracle.containers,
        "accepted": sum(1 for found in expect.values() if found["accepted"]),
        "started": sum(1 for found in expect.values() if found["started_at"]),
        "started_from_created": oracle.started_from_created,
        "history_records_to_rename": oracle.rewrites,
        "events_to_write": dict(sorted(oracle.events.items())),
        "children_to_take_out": len(oracle.moved),
        "accepted_open_containers": len(oracle.derived),
        "remembered_routes_to_drop": len(oracle.dropped_prefs),
        "item_projects": oracle.item_projects,
        "items_losing_labels": len(oracle.labels_dropped),
    }


def _item_projects_file(context: Context) -> Mapping[str, Any]:
    found = context.memo.get("item_projects")
    if not isinstance(found, Mapping):
        raise UnmetError("the item projects file was not read before the steps")
    return found


def _read_item_projects(conn: sqlite3.Connection, context: Context, oracle: Oracle) -> None:
    """The oracle's reading of the projects `item-projects` gives and the labels `labels`
    takes, in Python.

    A task with a nonempty entry in the file gets that entry's projects, any other
    task its space's former project as `migrated`; a container gets none and keeps
    its labels. The searches are read before any write, with what each will find
    besides: the tasks a word of one of their projects' ids starts the stem.
    """

    entries = _item_projects_file(context)["items"]
    former = {
        str(identity): str(project)
        for identity, project in conn.execute(
            "SELECT planning_space_id, project_id FROM planning_spaces"
        )
    }
    spaces = {
        str(identity): str(space)
        for identity, space in conn.execute(
            "SELECT work_item_id, planning_space_id FROM work_items"
        )
    }
    for identity, found in oracle.expect.items():
        entry = entries.get(identity) or {"projects": [], "drop_labels": []}
        oracle.labels_after[identity] = list(found["labels"])
        if found["container"]:
            continue
        given = {(str(p["project_id"]), str(p["source"])) for p in entry["projects"]}
        oracle.projects[identity] = given or {(former[spaces[identity]], _MIGRATED)}
        kept = [label for label in found["labels"] if label not in entry["drop_labels"]]
        if kept != found["labels"]:
            oracle.labels_after[identity] = kept
            oracle.labels_dropped.add(identity)
    oracle.item_projects = sum(len(given) for given in oracle.projects.values())
    queries = _search_queries(
        conn, {project for given in oracle.projects.values() for project, _ in given}
    )
    oracle.search = _search(conn, queries)
    for stem in queries:
        oracle.search_added[stem] = sorted(
            identity
            for identity, given in oracle.projects.items()
            if any(term.startswith(stem) for project, _ in given for term in words.terms(project))
        )


def _project_scoped(record: str) -> bool:
    """Whether a remembered route's scope is a project, read in Python for `oracle`."""

    try:
        value = json.loads(record)
    except ValueError:
        return False
    scope = value.get("scope") if isinstance(value, dict) else None
    return isinstance(scope, dict) and scope.get("kind") == "project"


def _data_scope_id(conn: sqlite3.Connection) -> str:
    row = conn.execute("SELECT data_scope_id FROM platform_store_metadata").fetchone()
    return "" if row is None else str(row[0])


def _spaces(conn: sqlite3.Connection) -> set[tuple[str, str, str, int]]:
    return {
        (str(row[0]), str(row[1]), str(row[2]), int(row[3]))
        for row in conn.execute(
            "SELECT planning_space_id, key, name, next_number FROM planning_spaces"
        )
    }


def _oracle_needed(conn: sqlite3.Connection, context: Context) -> bool:
    del conn
    return "oracle" not in context.memo


# -- states --------------------------------------------------------------------


def _states_needed(conn: sqlite3.Connection, context: Context) -> bool:
    del context
    old = conn.execute(
        f"SELECT 1 FROM workflow_states WHERE category IN ({_sql_set(_RENAMED_CATEGORIES)})"  # noqa: S608
        " LIMIT 1"
    ).fetchone()
    lacking = conn.execute(
        "SELECT 1 FROM workflows w WHERE NOT EXISTS (SELECT 1 FROM workflow_states s"
        " WHERE s.workflow_id = w.workflow_id AND s.category = 'deferred')"
        " OR NOT EXISTS (SELECT 1 FROM workflow_states s"
        " WHERE s.workflow_id = w.workflow_id AND s.category = ?) LIMIT 1",
        (_SERVICE,),
    ).fetchone()
    return old is not None or lacking is not None


def _add_state(
    conn: sqlite3.Connection, workflow: str, spec: tuple[str, str, str], position: int
) -> int:
    """One state with every move to and from each other state of its workflow; how
    many moves that is."""

    key, name, category = spec
    state = model.new_id()
    others = [
        str(row[0])
        for row in conn.execute(
            "SELECT state_id FROM workflow_states WHERE workflow_id = ?", (workflow,)
        )
    ]
    conn.execute(
        "INSERT INTO workflow_states(state_id,workflow_id,key,name,category,position,is_terminal)"
        " VALUES(?,?,?,?,?,?,?)",
        (
            state,
            workflow,
            key,
            name,
            category,
            position,
            int(category in model.TERMINAL_CATEGORIES),
        ),
    )
    conn.executemany(
        "INSERT INTO workflow_transitions(workflow_id,from_state_id,to_state_id) VALUES(?,?,?)",
        [pair for other in others for pair in ((workflow, other, state), (workflow, state, other))],
    )
    return 2 * len(others)


def _migrate_states(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    """`states`: the eight categories and the service state in every workflow."""

    stored = str(
        conn.execute("SELECT sql FROM sqlite_master WHERE name = 'workflow_states'").fetchone()[0]
    )
    if f"'{_SERVICE}'" not in stored:
        mapped = " ".join(f"WHEN '{old}' THEN '{new}'" for old, new in _RENAMED_CATEGORIES.items())
        planning_store.rebuild_table(
            conn,
            "workflow_states",
            planning_store.table_definition(
                "workflow_states", f"workflow_states{planning_store.REPLACEMENT}"
            ),
            "SELECT state_id, workflow_id, key, name,"  # noqa: S608 - the model's own names
            f" CASE category {mapped} ELSE category END, position, is_terminal"
            " FROM workflow_states",
        )
    renames: dict[str, dict[str, str]] = {}
    names = 0
    for category, old_key, old_name, new_key, new_name in _RENAMED_DEFAULTS:
        for state in conn.execute(
            "SELECT state_id, workflow_id, key, name FROM workflow_states"
            " WHERE category = ? AND (key = ? OR name = ?)",
            (category, old_key, old_name),
        ).fetchall():
            workflow = str(state["workflow_id"])
            taken = conn.execute(
                "SELECT 1 FROM workflow_states WHERE workflow_id = ? AND key = ?",
                (workflow, new_key),
            ).fetchone()
            if state["key"] == old_key and taken is None:
                conn.execute(
                    "UPDATE workflow_states SET key = ? WHERE state_id = ?",
                    (new_key, state["state_id"]),
                )
                renames.setdefault(workflow, {})[old_key] = new_key
            if state["name"] == old_name:
                conn.execute(
                    "UPDATE workflow_states SET name = ? WHERE state_id = ?",
                    (new_name, state["state_id"]),
                )
                names += 1
    added_states = added_moves = 0
    for (workflow,) in conn.execute(
        "SELECT workflow_id FROM workflows ORDER BY workflow_id"
    ).fetchall():
        categories = {
            str(row[0])
            for row in conn.execute(
                "SELECT category FROM workflow_states WHERE workflow_id = ?", (workflow,)
            )
        }
        if "deferred" not in categories:
            anchor = int(
                conn.execute(
                    "SELECT coalesce(MAX(position), -1) FROM workflow_states"
                    " WHERE workflow_id = ? AND category = 'triage'",
                    (workflow,),
                ).fetchone()[0]
            )
            # Two passes, so no position is held twice on the way.
            conn.execute(
                "UPDATE workflow_states SET position = -position - 1"
                " WHERE workflow_id = ? AND position > ?",
                (workflow, anchor),
            )
            conn.execute(
                "UPDATE workflow_states SET position = -position"
                " WHERE workflow_id = ? AND position < 0",
                (workflow,),
            )
            added_moves += _add_state(conn, workflow, _DEFERRED, anchor + 1)
            added_states += 1
        if _SERVICE not in categories:
            last = int(
                conn.execute(
                    "SELECT coalesce(MAX(position), -1) FROM workflow_states WHERE workflow_id = ?",
                    (workflow,),
                ).fetchone()[0]
            )
            added_moves += _add_state(conn, workflow, _SERVICE_STATE, last + 1)
            added_states += 1
    context.memo["renames"] = renames
    return {
        "workflows_with_keys_renamed": len(renames),
        "keys_renamed": sum(len(renamed) for renamed in renames.values()),
        "names_renamed": names,
        "states_added": added_states,
        "transitions_added": added_moves,
    }


def _check_states(conn: sqlite3.Connection, context: Context) -> None:
    if _states_needed(conn, context):
        raise UnmetError(
            "a workflow still has an old category or lacks Deferred or the service state"
        )


# -- history -------------------------------------------------------------------


def _history_to_rename(conn: sqlite3.Connection, context: Context) -> list[tuple[str, int]]:
    renames: dict[str, dict[str, str]] = context.memo.get("renames", {})
    if not renames:
        return []
    found: list[tuple[str, int]] = []
    for row in conn.execute(
        "SELECT e.id, e.detail, w.workflow_id FROM work_item_events e"
        " JOIN work_items w ON w.work_item_id = e.work_item_id"
        " WHERE e.action IN ('created','transitioned')"
        " AND w.workflow_id IN (SELECT value FROM json_each(?))",
        (json.dumps(sorted(renames)),),
    ):
        changed = _renamed(str(row["detail"]), renames[str(row["workflow_id"])])
        if changed is not None:
            found.append((changed, int(row["id"])))
    return found


def _rename_history(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    """`history`: the renamed keys in `created` and `transitioned`, where a key stands only."""

    changed = _history_to_rename(conn, context)
    conn.executemany("UPDATE work_item_events SET detail = ? WHERE id = ?", changed)
    context.memo["rewrites"] = len(changed)
    return {"records_renamed": len(changed)}


def _history_needed(conn: sqlite3.Connection, context: Context) -> bool:
    return bool(_history_to_rename(conn, context))


def _check_history(conn: sqlite3.Connection, context: Context) -> None:
    if _history_to_rename(conn, context):
        raise UnmetError("a record still names a renamed key")


# -- items ---------------------------------------------------------------------

#: The columns the rebuilt table takes from the old one as they are.
_KEPT_COLUMNS = (
    "work_item_id",
    "planning_space_id",
    "number",
    "workflow_id",
    "state_id",
    "parent_id",
    "priority",
    "claim_ref",
    "title",
    "description",
    "summary",
    "summary_comment_id",
    "source",
    "checklist",
    "revision",
    "created_at",
    "updated_at",
    "claim_call_id",
)
#: The columns of the old table no row of the new one holds: `owner_ref` was never
#: written, and `position` held the order a person set by hand, which the order of
#: work now computes.
_DROPPED_COLUMNS = frozenset({"owner_ref", "position"})
#: The index whose stored text names a dropped column: dropped before the rebuild
#: and created after it from this build's declaration, where every other index and
#: trigger is created again from the text the store holds.
_REDECLARED_INDEX = "work_items_state"

_SHAPE_ITEMS = (
    f"""CREATE TEMP TABLE work_model_entries AS
    SELECT e.work_item_id AS item, e.created_at AS at, s.category AS category
    FROM work_item_events e
    JOIN work_items w ON w.work_item_id = e.work_item_id
    JOIN workflow_states s ON s.workflow_id = w.workflow_id AND s.key = {_ENTERED_SQL}
    WHERE e.action IN ('created', 'transitioned')""",  # noqa: S608 - the model's own words
    "CREATE INDEX temp.work_model_entries_item ON work_model_entries(item, category)",
    f"""CREATE TEMP TABLE work_model_items AS
    SELECT w.work_item_id AS item, w.parent_id AS parent, s.category AS category,
        w.created_at AS created_at,
        (w.kind = 'epic' OR EXISTS (SELECT 1 FROM work_items c WHERE c.parent_id = w.work_item_id))
            AS container,
        (SELECT MIN(e.at) FROM work_model_entries e
         WHERE e.item = w.work_item_id AND e.category IN ({_sql_set(_ACCEPTING)})) AS stood_at,
        (SELECT MIN(at) FROM (
            SELECT e.at AS at FROM work_model_entries e
            WHERE e.item = w.work_item_id AND e.category IN ({_sql_set(_STARTING)})
            UNION ALL SELECT c.created_at FROM work_item_events c
            WHERE c.work_item_id = w.work_item_id AND c.action IN ('claimed', 'taken_over')
        )) AS began_at
    FROM work_items w JOIN workflow_states s ON s.state_id = w.state_id""",  # noqa: S608
    "CREATE INDEX temp.work_model_items_parent ON work_model_items(parent)",
    f"""CREATE TEMP TABLE work_model_accepted AS
    SELECT i.item,
        CASE WHEN i.container THEN
            i.stood_at IS NOT NULL OR i.category IN ({_sql_set(_ACCEPTING)}) OR EXISTS (
                SELECT 1 FROM work_model_items c WHERE c.parent = i.item
                AND (c.stood_at IS NOT NULL OR c.category IN ({_sql_set(_ACCEPTING)})))
        ELSE (i.stood_at IS NOT NULL OR i.category IN ({_sql_set(_ACCEPTING)}))
            AND i.category != 'triage' END AS accepted,
        coalesce(CASE WHEN i.container THEN (
            SELECT MIN(at) FROM (SELECT i.stood_at AS at
                UNION ALL SELECT c.stood_at FROM work_model_items c WHERE c.parent = i.item))
        ELSE i.stood_at END, i.created_at) AS accepted_at
    FROM work_model_items i""",  # noqa: S608
)
_ITEM_ROWS = f"""({", ".join(_KEPT_COLUMNS)}, kind, labels, acceptance, accepted_at, started_at)
SELECT {", ".join(f"w.{column}" for column in _KEPT_COLUMNS)},
    CASE WHEN i.container THEN '{_CONTAINER}' ELSE w.kind END,
    CASE WHEN i.container AND w.kind IN ('bug', 'improvement')
        AND NOT EXISTS (SELECT 1 FROM json_each(w.labels) l WHERE l.value = w.kind)
    THEN json_insert(w.labels, '$[#]', w.kind) ELSE w.labels END,
    CASE WHEN a.accepted THEN 'migrated' END,
    CASE WHEN a.accepted THEN a.accepted_at END,
    CASE WHEN NOT i.container THEN coalesce(i.began_at,
        CASE WHEN i.category IN ({_sql_set(_STARTING)}) THEN w.created_at END) END
FROM work_items w
JOIN work_model_items i ON i.item = w.work_item_id
JOIN work_model_accepted a ON a.item = w.work_item_id"""  # noqa: S608 - the model's own words


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in conn.execute(f'PRAGMA table_info("{table}")')}


def _table_info(conn: sqlite3.Connection, table: str) -> list[tuple[str, ...]]:
    """Each column of `table` as the pragma gives it: name, type, NOT NULL, default, key."""

    return sorted(
        tuple(str(value) for value in row[1:6])
        for row in conn.execute(f'PRAGMA table_info("{table}")')
    )


#: The table the Board cutover left in a shape of its own: it renamed `card_id` to
#: `work_item_id` and kept the type `INTEGER`, where a fresh store declares `TEXT`.
_SESSIONS = "sessions"


def _fresh_table(context: Context, table: str) -> tuple[str, list[tuple[str, ...]]]:
    """The `CREATE TABLE` of one table and its columns, as a fresh store of this build
    holds them; read once a run."""

    found = context.memo.get(f"fresh_{table}")
    if found is None:
        if context.reference is None:
            raise UnmetError("no fresh store to compare with")
        with context.reference() as fresh:
            declared = fresh.execute(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
            ).fetchone()
            found = (str(declared[0]), _table_info(fresh, table))
        context.memo[f"fresh_{table}"] = found
    return found


def _sessions_needed(conn: sqlite3.Connection, context: Context) -> bool:
    return _table_info(conn, _SESSIONS) != _fresh_table(context, _SESSIONS)[1]


def _rebuild_sessions(conn: sqlite3.Connection, context: Context) -> list[str]:
    """`sessions` in the shape a fresh store declares, every value carried as stored."""

    definition, names = _fresh_rebuild(conn, context, _SESSIONS)
    carried = ", ".join(names)
    rows = f"({carried}) SELECT {carried} FROM {_SESSIONS}"  # noqa: S608 - the pragma's names
    return planning_store.rebuild_table(conn, _SESSIONS, definition, rows)


def _fresh_rebuild(conn: sqlite3.Connection, context: Context, table: str) -> tuple[str, list[str]]:
    """What rebuilding `table` to a fresh store's declaration takes: that declaration
    under the replacement's name, and the columns of it the table holds, in its order.

    A column the table holds that this build does not declare is refused: its values
    would have nowhere to go.
    """

    declared, columns = _fresh_table(context, table)
    names = [column[0] for column in columns]
    present = _columns(conn, table)
    unknown = present - set(names)
    if unknown:
        raise RuntimeError(f"{table} holds columns this build does not know: {sorted(unknown)}")
    definition = re.sub(
        rf'^CREATE TABLE\s+"?{table}"?',
        f"CREATE TABLE {table}{planning_store.REPLACEMENT}",
        declared,
        count=1,
        flags=re.IGNORECASE,
    )
    return definition, [name for name in names if name in present]


def _items_needed(conn: sqlite3.Connection, context: Context) -> bool:
    # A dropped column still standing is a table a branch build rebuilt before the
    # column went: the step then refuses it, since such a store is only ever a copy.
    columns = _columns(conn, "work_items")
    return (
        "acceptance" not in columns
        or bool(columns & _DROPPED_COLUMNS)
        or _sessions_needed(conn, context)
    )


def _migrate_items(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    """`items`: the item table in its new shape, each row with its kind, acceptance and start,
    and `sessions` in the shape a fresh store declares when the Board era left it another."""

    sessions = _rebuild_sessions(conn, context) if _sessions_needed(conn, context) else None
    if "acceptance" in _columns(conn, "work_items"):
        return {"sessions_rebuilt": sessions}
    unknown = (
        _columns(conn, "work_items") - set(_KEPT_COLUMNS) - {"kind", "labels"} - _DROPPED_COLUMNS
    )
    if unknown:
        raise RuntimeError(f"work_items holds columns this build does not know: {sorted(unknown)}")
    planning_store.widen_event_actions(conn)
    for statement in _SHAPE_ITEMS:
        conn.execute(statement)
    conn.execute(f"DROP INDEX IF EXISTS {_REDECLARED_INDEX}")
    try:
        recreated = planning_store.rebuild_table(
            conn,
            "work_items",
            planning_store.table_definition(
                "work_items", f"work_items{planning_store.REPLACEMENT}"
            ),
            _ITEM_ROWS,
        )
        conn.execute(planning_store.WORK_ITEMS_STATE_INDEX)
        recreated.append(_REDECLARED_INDEX)
    finally:
        for table in ("work_model_accepted", "work_model_items", "work_model_entries"):
            conn.execute(f"DROP TABLE IF EXISTS temp.{table}")
    counted = conn.execute(
        "SELECT SUM(kind = ?), SUM(acceptance IS NOT NULL), SUM(started_at IS NOT NULL)"
        " FROM work_items",
        (_CONTAINER,),
    ).fetchone()
    return {
        "containers": int(counted[0] or 0),
        "accepted": int(counted[1] or 0),
        "started": int(counted[2] or 0),
        "indexes_and_triggers_recreated": recreated,
        "sessions_rebuilt": sessions,
    }


def _check_items(conn: sqlite3.Connection, context: Context) -> None:
    if _items_needed(conn, context):
        raise UnmetError("work_items or sessions has not taken its new shape")


# -- claims and places ---------------------------------------------------------

_CLAIMED = "(w.claim_ref != '' OR w.claim_call_id IS NOT NULL OR w.checklist LIKE '%claimed_by%')"


def _held(conn: sqlite3.Connection, where: str, parameters: tuple[object, ...] = ()) -> list[str]:
    """The items matching `where` that hold a claim of the item or of a step."""

    found = []
    for row in conn.execute(
        "SELECT w.work_item_id, w.claim_ref, w.claim_call_id, w.checklist FROM work_items w"  # noqa: S608
        f" JOIN workflow_states s ON s.state_id = w.state_id WHERE {where} AND {_CLAIMED}",
        parameters,
    ):
        if row["claim_ref"] or row["claim_call_id"] is not None or _claimed_steps(row["checklist"]):
            found.append(str(row["work_item_id"]))
    return found


_UNPLACED_CONTAINERS = (
    "SELECT w.work_item_id, svc.state_id FROM work_items w"
    " JOIN workflow_states s ON s.state_id = w.state_id"
    " JOIN workflow_states svc ON svc.workflow_id = w.workflow_id AND svc.category = ?"
    " WHERE w.kind = ? AND w.acceptance IS NOT NULL AND s.is_terminal = 0 AND s.category != ?"
)


def _containers_needed(conn: sqlite3.Connection, context: Context) -> bool:
    del context
    return bool(_held(conn, "w.kind = ?", (_CONTAINER,))) or (
        conn.execute(_UNPLACED_CONTAINERS, (_SERVICE, _CONTAINER, _SERVICE)).fetchone() is not None
    )


def _migrate_containers(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    """`containers`: nobody holds a container, and an accepted open one stands in the
    service state."""

    released = [_release(conn, context, item) for item in _held(conn, "w.kind = ?", (_CONTAINER,))]
    placed = conn.execute(_UNPLACED_CONTAINERS, (_SERVICE, _CONTAINER, _SERVICE)).fetchall()
    for item, state in placed:
        conn.execute("UPDATE work_items SET state_id = ? WHERE work_item_id = ?", (state, item))
        _log(conn, context, str(item), "opened", REASON)
    return {"containers_released": sum(released), "containers_opened": len(placed)}


def _check_containers(conn: sqlite3.Connection, context: Context) -> None:
    if _containers_needed(conn, context):
        raise UnmetError("a container is still held, or an accepted open one stands elsewhere")


_UNHELD_ACTIVE = (
    "SELECT w.* FROM work_items w JOIN workflow_states s ON s.state_id = w.state_id"
    " WHERE w.kind != ? AND s.category = 'active' AND w.claim_ref = ''"
)


def _unheld_active(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return [
        row
        for row in conn.execute(_UNHELD_ACTIVE, (_CONTAINER,))
        if not _claimed_steps(row["checklist"])
    ]


_UNWORKED = f"w.kind != ? AND s.category NOT IN ({_sql_set(_HELD)})"


def _holders_needed(conn: sqlite3.Connection, context: Context) -> bool:
    del context
    return bool(_held(conn, _UNWORKED, (_CONTAINER,))) or bool(_unheld_active(conn))


def _migrate_holders(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    """`task-holders`: only a task at work or blocked is held, and one at work always is."""

    released = [_release(conn, context, item) for item in _held(conn, _UNWORKED, (_CONTAINER,))]
    references = _references(conn)
    unheld = _unheld_active(conn)
    for row in unheld:
        _move(conn, context, row, "ready", references[str(row["work_item_id"])])
    return {"tasks_released": sum(released), "unheld_tasks_made_ready": len(unheld)}


def _check_holders(conn: sqlite3.Connection, context: Context) -> None:
    if _holders_needed(conn, context):
        raise UnmetError("a task outside work is still held, or one at work has no holder")


_OPEN_UNDER_CLOSED = (
    "SELECT c.*, p.work_item_id AS container, cs.category AS category"
    " FROM work_items c JOIN work_items p ON p.work_item_id = c.parent_id"
    " JOIN workflow_states ps ON ps.state_id = p.state_id"
    " JOIN workflow_states cs ON cs.state_id = c.state_id"
    " WHERE ps.is_terminal = 1 AND cs.is_terminal = 0 ORDER BY c.work_item_id"
)


def _left_needed(conn: sqlite3.Connection, context: Context) -> bool:
    del context
    return conn.execute(_OPEN_UNDER_CLOSED).fetchone() is not None


def _take_out_children(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    """`children-left`: an open child of a closed container leaves it for triage, the container
    recording that it left."""

    references = _references(conn)
    moved = []
    for child in conn.execute(_OPEN_UNDER_CLOSED).fetchall():
        identity, container = str(child["work_item_id"]), str(child["container"])
        if child["category"] != "triage":
            _move(conn, context, child, "triage", references[identity])
        conn.execute(
            "UPDATE work_items SET parent_id = NULL, acceptance = NULL, accepted_at = NULL"
            " WHERE work_item_id = ?",
            (identity,),
        )
        _release(conn, context, identity)
        _log(
            conn,
            context,
            container,
            "child_left",
            f"{references[identity]}: {CHILD_LEFT_REASON}",
        )
        moved.append({"reference": references[identity], "from": references[container]})
    moved.sort(key=lambda entry: (entry["from"], entry["reference"]))
    context.memo["moved"] = moved
    return {"children_taken_out": moved}


def _check_left(conn: sqlite3.Connection, context: Context) -> None:
    if _left_needed(conn, context):
        raise UnmetError("a closed container still has an open child")


# -- the trigger ---------------------------------------------------------------


def _trigger_needed(conn: sqlite3.Connection, context: Context) -> bool:
    del context
    present = {
        str(row[0]) for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'trigger'")
    }
    return not set(planning_store.STATE_FITS_KIND_TRIGGERS) <= present


def _create_trigger(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    """`checks`: from here on the store refuses an item standing where its kind may not."""

    del context
    for statement in planning_store.STATE_FITS_KIND:
        conn.execute(statement)
    return {"triggers": sorted(planning_store.STATE_FITS_KIND_TRIGGERS)}


def _check_trigger(conn: sqlite3.Connection, context: Context) -> None:
    if _trigger_needed(conn, context):
        raise UnmetError("the trigger that keeps each kind in its states is missing")


def _item_projects_needed(conn: sqlite3.Connection, context: Context) -> bool:
    del context
    present = {
        str(row[0])
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE (type = 'table' AND name = 'work_item_projects')"
            " OR (type = 'trigger' AND tbl_name = 'work_item_projects')"
        )
    }
    return not {"work_item_projects", *words.PROJECT_TRIGGERS} <= present


def _create_item_projects(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    """`item-projects`: the table of the projects each item changes, as a fresh store holds it, with
    the two triggers that mark an item for the word index when it gains or loses one,
    filled in SQL from the file and the spaces' former projects."""

    for statement in (*planning_store.ITEM_PROJECTS, *words.PROJECT_TRIGGER_STATEMENTS):
        conn.execute(statement)
    entries = _item_projects_file(context)["items"]
    given = sorted(
        (identity, str(project["project_id"]), str(project["source"]))
        for identity, entry in entries.items()
        for project in entry["projects"]
    )
    conn.executemany(
        "INSERT INTO work_item_projects(work_item_id, project_id, source) SELECT ?1, ?2, ?3"
        " WHERE EXISTS (SELECT 1 FROM work_items WHERE work_item_id = ?1 AND kind != ?4)",
        [(*row, _CONTAINER) for row in given],
    )
    migrated = conn.execute(
        "INSERT INTO work_item_projects(work_item_id, project_id, source)"
        " SELECT w.work_item_id, p.project_id, ? FROM work_items w"
        " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
        " WHERE w.kind != ? AND w.work_item_id NOT IN (SELECT value FROM json_each(?))",
        (_MIGRATED, _CONTAINER, json.dumps(sorted({row[0] for row in given}))),
    ).rowcount
    return {
        "rows": int(conn.execute("SELECT COUNT(*) FROM work_item_projects").fetchone()[0]),
        "migrated": migrated,
    }


def _check_item_projects(conn: sqlite3.Connection, context: Context) -> None:
    if _item_projects_needed(conn, context):
        raise UnmetError("the table of the items' projects or its search triggers are missing")


# -- the labels a project now carries ------------------------------------------


def _labels_to_drop(conn: sqlite3.Connection, context: Context) -> list[tuple[str, str]]:
    """Each item whose labels still hold one its entry drops, with the labels it keeps."""

    changed: list[tuple[str, str]] = []
    for identity, entry in sorted(_item_projects_file(context)["items"].items()):
        if not entry["drop_labels"]:
            continue
        row = conn.execute(
            "SELECT labels FROM work_items WHERE work_item_id = ? AND kind != ?",
            (identity, _CONTAINER),
        ).fetchone()
        if row is None:
            continue
        labels = json.loads(row[0] or "[]")
        kept = [label for label in labels if label not in entry["drop_labels"]]
        if kept != labels:
            changed.append((model.dumps(kept), identity))
    return changed


def _index_stale(conn: sqlite3.Connection) -> bool:
    stale = f"SELECT 1 FROM {words.ROWS} WHERE stale = 1 LIMIT 1"  # noqa: S608
    return conn.execute(stale).fetchone() is not None


def _labels_needed(conn: sqlite3.Connection, context: Context) -> bool:
    return bool(_labels_to_drop(conn, context)) or _index_stale(conn)


def _drop_labels(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    """`labels`: a label whose project the item now names leaves it, and the index catches up.

    The labels go through the store's own spelling; the trigger on them, and the one
    on each project `item-projects` gave, marked the items stale, and the index reads them here,
    inside the transaction, as every verb that writes an item's text does.
    """

    changed = _labels_to_drop(conn, context)
    conn.executemany("UPDATE work_items SET labels = ? WHERE work_item_id = ?", changed)
    stale = int(conn.execute(f"SELECT COUNT(*) FROM {words.ROWS} WHERE stale = 1").fetchone()[0])  # noqa: S608
    words.bring_current(conn)
    return {"items": len(changed), "index_rows_read": stale}


def _check_labels(conn: sqlite3.Connection, context: Context) -> None:
    if _labels_to_drop(conn, context):
        raise UnmetError("an item still holds a label its entry drops")


# -- the space without its project ---------------------------------------------


def _space_needed(conn: sqlite3.Connection, context: Context) -> bool:
    del context
    columns = {str(row[1]) for row in conn.execute("PRAGMA table_info(planning_spaces)")}
    return "project_id" in columns or "launch_place" not in columns


def _rebuild_spaces(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    """`spaces`: `planning_spaces` as a fresh store holds it, each space launching in itself.

    Every column but the project is kept as it was; the launch place is the one
    every space starts with.
    """

    del context
    recreated = planning_store.rebuild_table(
        conn,
        "planning_spaces",
        planning_store.table_definition(
            "planning_spaces", f"planning_spaces{planning_store.REPLACEMENT}"
        ),
        "SELECT planning_space_id, name, key, provider_kind, next_number,"  # noqa: S608
        f" '{model.LAUNCH_PLACES[0]}', created_at, updated_at FROM planning_spaces",
    )
    spaces = int(conn.execute("SELECT COUNT(*) FROM planning_spaces").fetchone()[0])
    return {"spaces": spaces, "recreated": recreated}


def _check_space(conn: sqlite3.Connection, context: Context) -> None:
    if _space_needed(conn, context):
        raise UnmetError("planning_spaces still holds a project or has no launch place")


# -- the last route ------------------------------------------------------------

_LAST_ROUTE = "last-route"
#: The remembered route whose scope is a project, read in SQL for `last-route`.
_PROJECT_ROUTE = (
    "key = 'last-route' AND json_valid(record_json)"
    " AND json_type(record_json, '$.scope') = 'object'"
    " AND json_extract(record_json, '$.scope.kind') = 'project'"
)


def _route_needed(conn: sqlite3.Connection, context: Context) -> bool:
    del context
    return (
        conn.execute(f"SELECT 1 FROM platform_ui_prefs WHERE {_PROJECT_ROUTE}").fetchone()  # noqa: S608
        is not None
    )


def _drop_project_route(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    """`last-route`: the last route a project scoped goes; the shell then opens where it starts."""

    del context
    dropped = conn.execute(f"DELETE FROM platform_ui_prefs WHERE {_PROJECT_ROUTE}").rowcount  # noqa: S608
    return {"dropped": dropped}


def _check_route(conn: sqlite3.Connection, context: Context) -> None:
    if _route_needed(conn, context):
        raise UnmetError("a remembered route still has a project as its scope")


# -- the session a request asks ------------------------------------------------


def _addressee_needed(conn: sqlite3.Connection, context: Context) -> bool:
    del context
    return "addressee" not in _columns(conn, "work_item_requests") or (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'index'"
            " AND name = 'work_item_requests_addressee'"
        ).fetchone()
        is None
    )


def _add_addressee(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    """`addressee`: a request may ask an agent session instead of the owner.

    ALTER TABLE appends and cannot be run twice, so the column is added only when it
    is missing; the index is created if it is not there.
    """

    del context
    added = "addressee" not in _columns(conn, "work_item_requests")
    if added:
        conn.execute(f"ALTER TABLE work_item_requests ADD COLUMN {planning_store.ADDRESSEE_COLUMN}")
    conn.execute(planning_store.ADDRESSEE_INDEX)
    return {"column_added": added}


def _check_addressee(conn: sqlite3.Connection, context: Context) -> None:
    if _addressee_needed(conn, context):
        raise UnmetError("work_item_requests lacks the addressee column or its index")


# -- the words that wait for a session -----------------------------------------

_WAITING = "work_item_waiting_notices"
_WAITING_OBJECTS = (
    ("table", _WAITING),
    ("index", "work_item_waiting_notices_open"),
    ("index", "work_item_waiting_notices_delivered"),
)


def _waiting_needed(conn: sqlite3.Connection, context: Context) -> bool:
    del context
    return any(
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?", (kind, name)
        ).fetchone()
        is None
        for kind, name in _WAITING_OBJECTS
    )


def _create_waiting(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    """`waiting-words`: the table of a person's words nobody heard, and its indexes, each if
    missing."""

    del context
    created = (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (_WAITING,)
        ).fetchone()
        is None
    )
    conn.execute(planning_store.WAITING_NOTICES)
    conn.execute(planning_store.WAITING_OPEN_INDEX)
    conn.execute(planning_store.WAITING_DELIVERED_INDEX)
    return {"table_created": created}


def _check_waiting(conn: sqlite3.Connection, context: Context) -> None:
    if _waiting_needed(conn, context):
        raise UnmetError(f"{_WAITING} or one of its indexes is missing")


# -- how a request on a closed item ended --------------------------------------

_REQUESTS = "work_item_requests"
#: A request `ended-requests` ends, read from a row `r` of the requests joined to its item's state
#: `s`: pending, or stored `task_closed`, on an item that stands closed.
_ENDS = "s.is_terminal = 1 AND (r.status = 'pending' OR r.expired_reason = 'task_closed')"
#: The reason it ends with, by the category of that state, read apart from
#: `questions.closed_reason`, which `oracle` reads with.
_ENDED_REASON = "CASE s.category WHEN 'cancelled' THEN 'item_cancelled' ELSE 'item_completed' END"
#: The rows with their item's state `s` and their execution `x`.
_REQUEST_STATES = (
    " FROM work_item_requests r"
    " LEFT JOIN work_items w ON w.work_item_id = r.work_item_id"
    " LEFT JOIN workflow_states s ON s.state_id = w.state_id"
    " LEFT JOIN executions x ON x.execution_id = r.execution_id"
)


def _lapse(now: str) -> str:
    """Why a pending row `r` has lapsed at `now`, or null while it waits: past its
    deadline, or on an execution that is gone, ended or not live, in SQL apart from
    `questions.lapse`, which `oracle` reads with."""

    return (
        "CASE WHEN r.status != 'pending' THEN NULL"
        f" WHEN coalesce(r.expires_at, '') != '' AND r.expires_at <= '{now}' THEN 'deadline'"
        " WHEN coalesce(r.execution_id, '') != '' AND (x.execution_id IS NULL"
        " OR coalesce(x.ended_at, '') != ''"
        " OR coalesce(x.status, '') NOT IN ('starting', 'running')) THEN 'execution_closed'"
        " END"
    )


def _requests_needed(conn: sqlite3.Connection, context: Context) -> bool:
    del context
    declared = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", (_REQUESTS,)
    ).fetchone()
    return (
        "purpose" not in _columns(conn, _REQUESTS)
        or "'task_closed'" in str(declared[0])
        or conn.execute(f"SELECT 1{_REQUEST_STATES} WHERE {_ENDS} LIMIT 1").fetchone() is not None
    )


def _end_requests(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    """`ended-requests`: the requests in a fresh store's shape, each that a close ended stored so.

    Every value is carried as stored, but a request still pending on a closed item, or
    one that stored `task_closed`, which goes as a reason, ends `expired`: as
    `item_cancelled` on a cancelled item and as `item_completed` on any other closed
    one, at the moment of the migration if nothing closed it before, with its revision
    raised as any write of a request raises it, and with no event. A pending one that
    had lapsed ends as it lapsed, `deadline` or `execution_closed`, resolved when it
    lapsed where that is known, as the service's close writes it. A request that
    stored `task_closed` on an item that is open again is refused: which close ended
    it is not known, and nothing may guess.
    """

    reopened = [
        str(row[0])
        for row in conn.execute(
            f"SELECT r.request_id{_REQUEST_STATES}"
            " WHERE r.expired_reason = 'task_closed' AND coalesce(s.is_terminal, 0) = 0"
        )
    ]
    if reopened:
        raise RuntimeError(
            f"requests {reopened[:5]} stored task_closed on an item that is open:"
            " which close ended them is not known"
        )
    lapse = _lapse(context.now)
    reason = f"coalesce({lapse}, {_ENDED_REASON})"
    ended = Counter(
        str(row[0]) for row in conn.execute(f"SELECT {reason}{_REQUEST_STATES} WHERE {_ENDS}")
    )
    definition, carried = _fresh_rebuild(conn, context, _REQUESTS)
    lapsed_at = (
        f"CASE {lapse} WHEN 'deadline' THEN r.expires_at"
        " WHEN 'execution_closed' THEN nullif(x.ended_at, '') END"
    )
    changed = {
        "status": f"CASE WHEN {_ENDS} THEN 'expired' ELSE r.status END",
        "expired_reason": f"CASE WHEN {_ENDS} THEN {reason} ELSE r.expired_reason END",
        "answered_by": f"CASE WHEN {_ENDS} AND r.status = 'pending' AND {lapse} IS NULL"
        f" THEN '{AUTHOR}' ELSE r.answered_by END",
        "resolved_at": f"CASE WHEN {_ENDS}"
        f" THEN coalesce(r.resolved_at, {lapsed_at}, '{context.now}')"
        " ELSE r.resolved_at END",
        "revision": f"CASE WHEN {_ENDS} THEN r.revision + 1 ELSE r.revision END",
    }
    values = ", ".join(changed.get(name, f"r.{name}") for name in carried)
    # A trigger of another table that reads this one, as the shape of a thread reads a
    # question, would name a table that is gone between the drop and the rename, which
    # SQLite refuses: it goes first and comes back after, from its stored text.
    readers = conn.execute(
        "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name != ?"
        " AND sql LIKE ? ORDER BY rowid",
        (_REQUESTS, f"%{_REQUESTS}%"),
    ).fetchall()
    for name, _sql in readers:
        conn.execute(f'DROP TRIGGER "{name}"')
    recreated = planning_store.rebuild_table(
        conn,
        _REQUESTS,
        definition,
        f"({', '.join(carried)}) SELECT {values}{_REQUEST_STATES}",
    )
    for name, sql in readers:
        conn.execute(str(sql))
        recreated.append(str(name))
    return {"ended": dict(sorted(ended.items())), "recreated": recreated}


def _check_requests(conn: sqlite3.Connection, context: Context) -> None:
    if _requests_needed(conn, context):
        raise UnmetError(f"{_REQUESTS} has not taken its new shape, or one waits on a closed item")


STEPS = (
    Step("oracle", "read the oracle", _read_oracle, _oracle_needed),
    Step("states", "states", _migrate_states, _states_needed, _check_states),
    Step("history", "history", _rename_history, _history_needed, _check_history),
    Step("items", "items", _migrate_items, _items_needed, _check_items),
    Step("containers", "containers", _migrate_containers, _containers_needed, _check_containers),
    Step("task-holders", "task holders", _migrate_holders, _holders_needed, _check_holders),
    Step(
        "children-left",
        "closed containers with open children",
        _take_out_children,
        _left_needed,
        _check_left,
    ),
    Step("checks", "checks", _create_trigger, _trigger_needed, _check_trigger),
    Step("item-projects", "item projects", _create_item_projects, _item_projects_needed, _check_item_projects),
    Step("labels", "labels", _drop_labels, _labels_needed, _check_labels),
    Step("spaces", "the space", _rebuild_spaces, _space_needed, _check_space),
    Step("last-route", "the last route", _drop_project_route, _route_needed, _check_route),
    Step("addressee", "the session a request asks", _add_addressee, _addressee_needed, _check_addressee),
    Step("waiting-words", "words that wait for a session", _create_waiting, _waiting_needed, _check_waiting),
    Step(
        "item-projects",
        "item projects",
        _create_item_projects,
        _item_projects_needed,
        _check_item_projects,
    ),
    Step("labels", "labels", _drop_labels, _labels_needed, _check_labels),
    Step("spaces", "the space", _rebuild_spaces, _space_needed, _check_space),
    Step("last-route", "the last route", _drop_project_route, _route_needed, _check_route),
    Step(
        "addressee",
        "the session a request asks",
        _add_addressee,
        _addressee_needed,
        _check_addressee,
    ),
    Step(
        "ended-requests",
        "how a request on a closed item ended",
        _end_requests,
        _requests_needed,
        _check_requests,
    ),
)


# -- postconditions --------------------------------------------------------------


def _unmet(found: list[str], what: str) -> None:
    if found:
        shown = "; ".join(found[:5])
        more = f" and {len(found) - 5} more" if len(found) > 5 else ""
        raise UnmetError(f"{what}: {shown}{more}")


def _structure(conn: sqlite3.Connection) -> tuple[dict[str, dict[str, list]], list[str]]:
    """What the pragmas say of every table, and the trigger names: the shape of a store
    independent of how its `CREATE` text was written."""

    shape: dict[str, dict[str, list]] = {}
    for (table,) in conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 7) != 'sqlite_'"
        " ORDER BY name"
    ).fetchall():
        columns = _table_info(conn, str(table))
        indexes = sorted(
            (
                *(str(value) for value in row[1:5]),
                ",".join(
                    str(column[2]) for column in conn.execute(f'PRAGMA index_info("{row[1]}")')
                ),
            )
            for row in conn.execute(f'PRAGMA index_list("{table}")')
        )
        keys = sorted(
            tuple(str(value) for value in row[2:8])
            for row in conn.execute(f'PRAGMA foreign_key_list("{table}")')
        )
        shape[str(table)] = {"columns": columns, "indexes": indexes, "foreign_keys": keys}
    triggers = sorted(
        str(row[0]) for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'trigger'")
    )
    return shape, triggers


def _holds_fresh_shape(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    version = int(conn.execute("PRAGMA user_version").fetchone()[0])
    if version != context.schema:
        raise UnmetError(f"the store is at schema {version}, not {context.schema}")
    if context.reference is None:
        raise UnmetError("no fresh store to compare with")
    with context.reference() as fresh:
        expected, expected_triggers = _structure(fresh)
        context.memo["fresh_structure"] = (expected, expected_triggers)
        # Foreign keys are off on the store the migration holds; off on the fresh one
        # too, so a probe row needs no parent on either.
        fresh.commit()
        fresh.execute("PRAGMA foreign_keys=OFF")
        refused = work_model_probes.probe(conn, fresh)
    shape, triggers = _structure(conn)
    found = [f"table {name} is missing" for name in sorted(set(expected) - set(shape))]
    found += [f"table {name} is extra" for name in sorted(set(shape) - set(expected))]
    for name in sorted(set(shape) & set(expected)):
        for part in ("columns", "indexes", "foreign_keys"):
            if shape[name][part] != expected[name][part]:
                found.append(f"{name} differs in its {part.replace('_', ' ')}")
    if triggers != expected_triggers:
        found.append(
            f"triggers differ: missing {sorted(set(expected_triggers) - set(triggers))},"
            f" extra {sorted(set(triggers) - set(expected_triggers))}"
        )
    found += refused
    _unmet(found, "the store is not shaped like a fresh one")
    return {"schema": version, "tables": len(shape), "triggers": len(triggers)}


def _fresh_structure(context: Context) -> tuple[dict[str, dict[str, list]], list[str]]:
    """What `_structure` says of a fresh store of this build; `fresh-shape` reads it first."""

    found = context.memo.get("fresh_structure")
    if found is None:
        if context.reference is None:
            raise UnmetError("no fresh store to compare with")
        with context.reference() as fresh:
            found = _structure(fresh)
        context.memo["fresh_structure"] = found
    return found


def _expected_counts(oracle: Oracle) -> dict[str, int]:
    """The rows each table `oracle` counted holds after the steps, by what the oracle foresaw."""

    expected = dict(oracle.counts)
    expected["workflow_states"] += sum(found["adds"] for found in oracle.workflows.values())
    expected["workflow_transitions"] += sum(
        found["transitions"] for found in oracle.workflows.values()
    )
    expected["work_item_events"] += sum(oracle.events.values())
    expected["work_item_projects"] = expected.get("work_item_projects", 0) + oracle.item_projects
    expected["platform_ui_prefs"] = expected.get("platform_ui_prefs", 0) - len(oracle.dropped_prefs)
    return expected


def _p2(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    """The tables `oracle` counted and the projects `item-projects` fills hold the rows foreseen; any other
    table is `fresh-tables`'s."""

    oracle = _oracle(context)
    counts = _counts(conn)
    expected = _expected_counts(oracle)
    found = [
        f"{table} holds {counts.get(table)} rows, not {expected[table]}"
        for table in sorted(expected)
        if counts.get(table) != expected[table]
    ]
    written = dict(context.memo.get("written", Counter()))
    if written != dict(oracle.events):
        found.append(f"the steps wrote {written}, the oracle expected {dict(oracle.events)}")
    _unmet(found, "row counts")
    return {"tables": counts, "events_written": dict(sorted(written.items()))}


def _holds_integrity(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    del context
    broken = conn.execute("PRAGMA foreign_key_check").fetchall()
    _unmet([f"{row[0]} row {row[1]} names a missing {row[2]}" for row in broken], "foreign keys")
    result = str(conn.execute("PRAGMA integrity_check").fetchone()[0])
    if result != "ok":
        raise UnmetError(f"integrity check: {result}")
    return {"foreign_key_check": "empty", "integrity_check": result}


def _holds_no_epic(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    oracle = _oracle(context)
    epics, containers = conn.execute(
        "SELECT SUM(kind = 'epic'), SUM(kind = ?) FROM work_items", (_CONTAINER,)
    ).fetchone()
    found = []
    if epics:
        found.append(f"{epics} items are still epics")
    if int(containers or 0) != oracle.containers:
        found.append(f"{containers} containers, not {oracle.containers}")
    _unmet(found, "kinds")
    return {"containers": int(containers or 0)}


def _holds_parents(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    del context
    references = _references(conn)
    found = [
        f"{references[str(row[0])]} is under {references[str(row[1])]}, {why}"
        for row in conn.execute(
            "SELECT c.work_item_id, p.work_item_id, p.kind != ?, p.planning_space_id"
            " != c.planning_space_id FROM work_items c JOIN work_items p"
            " ON p.work_item_id = c.parent_id",
            (_CONTAINER,),
        )
        for why in (["not a container"] if row[2] else [])
        + (["in another space"] if row[3] else [])
    ]
    parents = {
        str(row[0]): row[1]
        for row in conn.execute("SELECT work_item_id, parent_id FROM work_items")
    }
    for start in parents:
        seen = {start}
        here = parents.get(start)
        for _ in range(len(parents)):
            if here is None:
                break
            if here in seen:
                found.append(f"{references[start]} stands in a cycle")
                break
            seen.add(str(here))
            here = parents.get(str(here))
    _unmet(found, "parents")
    return {"items_with_parent": sum(1 for parent in parents.values() if parent is not None)}


_DEFAULT_KEYS = frozenset(key for key, _, _ in model.DEFAULT_STATES)


def _holds_categories(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    oracle = _oracle(context)
    found = [
        f"a state is still in {row[0]}"
        for row in conn.execute(
            f"SELECT DISTINCT category FROM workflow_states"  # noqa: S608
            f" WHERE category IN ({_sql_set(_RENAMED_CATEGORIES)})"
        )
    ]
    for (workflow,) in conn.execute("SELECT workflow_id FROM workflows").fetchall():
        rows = conn.execute(
            "SELECT key, category FROM workflow_states WHERE workflow_id = ?", (workflow,)
        ).fetchall()
        categories = Counter(str(row[1]) for row in rows)
        missing = [category for category in model.PUBLIC_CATEGORIES if not categories[category]]
        if missing:
            found.append(f"workflow {workflow} has no state in {', '.join(missing)}")
        if categories[_SERVICE] != 1:
            found.append(f"workflow {workflow} has {categories[_SERVICE]} service states")
        keys = {str(row[0]) for row in rows}
        if oracle.workflows.get(workflow, {}).get("standard") and keys != _DEFAULT_KEYS:
            found.append(f"standard workflow {workflow} has the keys {sorted(keys)}")
    _unmet(found, "workflows")
    return {"standard_workflows": sum(1 for wf in oracle.workflows.values() if wf["standard"])}


def _holds_history_keys(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    oracle = _oracle(context)
    keys: dict[str, set[str]] = {}
    for workflow, key in conn.execute("SELECT workflow_id, key FROM workflow_states"):
        keys.setdefault(str(workflow), set()).add(str(key))
    retired = {"backlog", "todo", _SERVICE_STATE[0]}
    found = []
    for row in conn.execute(
        "SELECT e.id, e.detail, w.workflow_id FROM work_item_events e"
        " JOIN work_items w ON w.work_item_id = e.work_item_id"
        " WHERE e.action IN ('created','transitioned')"
    ):
        named = _keys(str(row[1]))
        if named is None:
            found.append(f"record {row[0]} is not a state record: {str(row[1])[:60]!r}")
            continue
        for key in named:
            if key in retired:
                found.append(f"record {row[0]} names {key}")
            elif key not in keys.get(str(row[2]), set()):
                found.append(f"record {row[0]} names {key}, which its workflow lacks")
    opened = {
        str(row[0])
        for row in conn.execute(
            "SELECT work_item_id FROM work_item_events WHERE action = 'opened' AND id > ?"
            " AND author = ? AND detail = ?",
            (oracle.last_event, AUTHOR, REASON),
        )
    }
    for (item,) in conn.execute(
        "SELECT w.work_item_id FROM work_items w JOIN workflow_states s ON s.state_id = w.state_id"
        " WHERE s.category = ?",
        (_SERVICE,),
    ):
        if str(item) not in opened:
            found.append(f"no opened record for the container {item}")
    rewrites = int(context.memo.get("rewrites", 0))
    if rewrites != oracle.rewrites:
        found.append(f"{rewrites} records renamed, the oracle expected {oracle.rewrites}")
    _unmet(found, "history")
    return {"records_renamed": rewrites}


def _holds_containers_unheld(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    oracle = _oracle(context)
    references = _references(conn)
    found = []
    places: Counter[str] = Counter()
    for row in conn.execute(
        "SELECT w.work_item_id, w.claim_ref, w.claim_call_id, w.checklist, w.acceptance,"
        " s.category FROM work_items w JOIN workflow_states s ON s.state_id = w.state_id"
        " WHERE w.kind = ?",
        (_CONTAINER,),
    ):
        identity, category = str(row["work_item_id"]), str(row["category"])
        places[category] += 1
        where = references[identity]
        if row["claim_ref"] or row["claim_call_id"] is not None or _claimed_steps(row["checklist"]):
            found.append(f"{where} is held")
        if category not in ("triage", _SERVICE, "completed", "cancelled"):
            found.append(f"{where} stands in {category}")
        if category == _SERVICE and row["acceptance"] is None:
            found.append(f"{where} stands in the service state with no basis")
        if category != oracle.expect[identity]["category"]:
            found.append(f"{where} stands in {category}, not {oracle.expect[identity]['category']}")
    _unmet(found, "containers")
    return {"containers_by_place": dict(sorted(places.items()))}


def _holds_holders(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    oracle = _oracle(context)
    references = _references(conn)
    found = []
    for row in conn.execute(
        "SELECT w.work_item_id, w.kind, w.claim_ref, w.claim_call_id, w.checklist, s.category"
        " FROM work_items w JOIN workflow_states s ON s.state_id = w.state_id"
    ):
        held_steps = bool(_claimed_steps(row["checklist"]))
        held = bool(row["claim_ref"]) or row["claim_call_id"] is not None or held_steps
        task = row["kind"] != _CONTAINER
        where = references[str(row["work_item_id"])]
        if held and (not task or row["category"] not in _HELD):
            found.append(f"{where} is held in {row['category']}")
        if task and row["category"] == "active" and not row["claim_ref"] and not held_steps:
            found.append(f"{where} is at work with no holder")
    written: Counter[tuple[str, str, str]] = Counter()
    for row in conn.execute(
        "SELECT e.work_item_id, e.action, e.detail, e.id > coalesce((SELECT MAX(t.id)"
        " FROM work_item_events t WHERE t.work_item_id = e.work_item_id"
        " AND t.action = 'transitioned'), 0) FROM work_item_events e"
        " WHERE e.id > ? AND e.action IN ('released','checklist_released')",
        (oracle.last_event,),
    ):
        written[(str(row[0]), str(row[1]), str(row[2]))] += 1
        if not row[3]:
            found.append(f"the release on {references[str(row[0])]} comes before its last move")
    if written != oracle.releases:
        missing = oracle.releases - written
        extra = written - oracle.releases
        found.append(f"releases differ: missing {len(missing)}, extra {len(extra)}")
    closed = conn.execute(
        "SELECT w.* FROM work_items w JOIN workflow_states s ON s.state_id = w.state_id"
        " WHERE s.is_terminal = 1"
    ).fetchall()
    closings = read_model.closings(conn, closed)
    for identity, closing in sorted(oracle.closings.items()):
        if closings.get(identity) != closing:
            found.append(
                f"{references[identity]} reads as closed {closings.get(identity)}, not {closing}"
            )
    _unmet(found, "holders")
    return {"releases": sum(written.values()), "closed_items_read": len(closings)}


def _holds_acceptance(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    oracle = _oracle(context)
    references = _references(conn)
    found = []
    for row in conn.execute(
        "SELECT w.work_item_id, w.acceptance, w.accepted_at, s.category FROM work_items w"
        " JOIN workflow_states s ON s.state_id = w.state_id"
    ):
        identity, basis, category = str(row[0]), row[1], str(row[3])
        where = references[identity]
        expected = oracle.expect[identity]
        if category in _ACCEPTING or category == _SERVICE:
            if basis is None:
                found.append(f"{where} in {category} has no basis")
        elif category == "triage" and basis is not None:
            found.append(f"{where} in triage has the basis {basis}")
        if basis not in (None, "migrated"):
            found.append(f"{where} has the basis {basis}")
        if (basis is not None) != expected["accepted"] or row[2] != expected["accepted_at"]:
            found.append(
                f"{where} has {basis} at {row[2]}, not"
                f" {'migrated' if expected['accepted'] else None} at {expected['accepted_at']}"
            )
    _unmet(found, "acceptance")
    return {"accepted": sum(1 for found in oracle.expect.values() if found["accepted"])}


def _holds_started(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    oracle = _oracle(context)
    references = _references(conn)
    found = []
    for identity, kind, started in conn.execute(
        "SELECT work_item_id, kind, started_at FROM work_items"
    ):
        expected = oracle.expect[str(identity)]["started_at"]
        if kind == _CONTAINER and started is not None:
            found.append(f"the container {references[str(identity)]} has a start")
        elif started != expected:
            found.append(f"{references[str(identity)]} started at {started}, not {expected}")
    _unmet(found, "starts")
    return {
        "started": sum(1 for found in oracle.expect.values() if found["started_at"]),
        "started_from_created": oracle.started_from_created,
    }


def _holds_derived(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    oracle = _oracle(context)
    containers = [
        str(row[0])
        for row in conn.execute(
            "SELECT w.work_item_id FROM work_items w"
            " JOIN workflow_states s ON s.state_id = w.state_id WHERE s.category = ?",
            (_SERVICE,),
        )
    ]
    derived = _derived(conn, _DERIVED_AFTER, containers)
    # The read model's own rule, over every space in the one pass a board reads with:
    # what a reader is shown must be what the store held before the migration.
    tree = item_tree.of_spaces(
        conn, [str(row[0]) for row in conn.execute("SELECT planning_space_id FROM planning_spaces")]
    )
    shown = {identity: tree.container_state(identity) for identity in containers}
    references = _references(conn)
    found = [
        f"{references.get(identity, identity)} derives {derived.get(identity)},"
        f" not {oracle.derived.get(identity)}"
        for identity in sorted(set(derived) | set(oracle.derived))
        if derived.get(identity) != oracle.derived.get(identity)
    ]
    found += [
        f"{references.get(identity, identity)} reads {shown.get(identity)},"
        f" not {oracle.derived.get(identity)}"
        for identity in sorted(set(shown) | set(oracle.derived))
        if shown.get(identity) != oracle.derived.get(identity)
    ]
    _unmet(found, "derived states")
    return {"derived": dict(sorted(Counter(derived.values()).items()))}


def _holds_indexes(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    oracle = _oracle(context)
    objects = _objects(conn)
    expected = {
        "work_items": sorted(
            set(oracle.objects["work_items"]) | set(planning_store.STATE_FITS_KIND_TRIGGERS)
        ),
        "workflow_states": sorted(oracle.objects["workflow_states"]),
    }
    found = [
        f"{table} has {sorted(objects[table])}, not {expected[table]}"
        for table in expected
        if sorted(objects[table]) != expected[table]
    ]
    rows, stale, items = conn.execute(
        f"SELECT (SELECT COUNT(*) FROM {words.ROWS}), (SELECT COUNT(*) FROM {words.ROWS}"  # noqa: S608
        f" WHERE stale = 1), (SELECT COUNT(*) FROM work_items i WHERE i.work_item_id IN"
        f" (SELECT work_item_id FROM {words.ROWS}))"
    ).fetchone()
    total = int(conn.execute("SELECT COUNT(*) FROM work_items").fetchone()[0])
    if rows != total or items != total:
        found.append(f"the index marks {rows} rows for {total} items")
    if stale:
        found.append(f"{stale} index rows are stale")
    searched = _search(conn, oracle.search)
    for stem, before in oracle.search.items():
        wanted = before if before is None else sorted({*before, *oracle.search_added[stem]})
        if searched.get(stem) != wanted:
            found.append(f"a search for {stem!r} finds other items")
    _unmet(found, "indexes, triggers and search")
    return {"index_rows": rows, "searches_compared": len(oracle.search)}


def _holds_identities(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    oracle = _oracle(context)
    found = []
    rows = {str(row["work_item_id"]): row for row in conn.execute("SELECT * FROM work_items")}
    if set(rows) != set(oracle.content):
        found.append("the set of item ids changed")
    numbers = {(str(row["planning_space_id"]), int(row["number"])) for row in rows.values()}
    if numbers != oracle.numbers:
        found.append("the set of space and number pairs changed")
    for identity, before in sorted(oracle.content.items()):
        row = rows.get(identity)
        if row is None:
            continue
        # A value no step writes is compared as stored, character for character, so a
        # step that rewrote it to the same meaning is still seen. Only what a step
        # writes anew is compared parsed: the checklist whose step claims
        # `containers` to `children-left` release goes through `model.dumps`, the
        # labels `items` adds a kind label to through `json_insert`, and those
        # `labels` takes some from through `model.dumps`, each in a spelling of its
        # own.
        for column in ("title", "description", "summary"):
            if row[column] != before[column]:
                found.append(f"{identity} changed its {column}")
        if before["steps_released"]:
            unclaimed = json.loads(before["checklist"])
            for step in unclaimed:
                if isinstance(step, dict) and step.get("claimed_by"):
                    step["claimed_by"] = ""
            if json.loads(row["checklist"]) != unclaimed:
                found.append(f"{identity} changed its checklist beyond the claims released")
        elif row["checklist"] != before["checklist"]:
            found.append(f"{identity} changed its checklist")
        if before["kind_label"] or identity in oracle.labels_dropped:
            labels = oracle.labels_after[identity]
            if json.loads(row["labels"]) != labels:
                found.append(f"{identity} has the labels {row['labels']}, not {labels}")
        elif row["labels"] != before["labels"]:
            found.append(f"{identity} changed its labels")
    _unmet(found, "content")
    return {"items": len(rows)}


def _holds_known_exceptions(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    oracle = _oracle(context)
    references = _references(conn)
    review = sorted(
        references[str(row[0])]
        for row in conn.execute(
            "SELECT w.work_item_id FROM work_items w"
            " JOIN workflow_states s ON s.state_id = w.state_id WHERE s.category = 'review'"
            " AND w.kind != ?",
            (_CONTAINER,),
        )
    )
    moved = context.memo.get("moved", [])
    found = []
    if moved != oracle.moved:
        found.append(f"taken out {moved}, the oracle expected {oracle.moved}")
    if review != oracle.review:
        found.append(f"in review {review}, the oracle expected {oracle.review}")
    _unmet(found, "known exceptions")
    return {"taken_out_of_closed_containers": moved, "tasks_left_in_review": review}


def _holds_store_identity(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    """The store keeps its identity, and each space its id, key, name and next number."""

    oracle = _oracle(context)
    found = []
    data_scope_id = _data_scope_id(conn)
    if data_scope_id != oracle.data_scope_id:
        found.append(f"the store is {data_scope_id}, not {oracle.data_scope_id}")
    spaces = _spaces(conn)
    found += [f"space {space} is missing" for space in sorted(oracle.spaces - spaces)]
    found += [f"space {space} is extra" for space in sorted(spaces - oracle.spaces)]
    _unmet(found, "the store and its spaces")
    return {"data_scope_id": data_scope_id, "spaces": len(spaces)}


def _holds_space_projects(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    """No space holds a project, and each launches in itself."""

    del context
    found = []
    columns = {str(row[1]) for row in conn.execute("PRAGMA table_info(planning_spaces)")}
    if "project_id" in columns:
        found.append("planning_spaces still has the column project_id")
    elif "launch_place" not in columns:
        found.append("planning_spaces has no column launch_place")
    else:
        found += [
            f"{row[0]} launches in {row[1]}"
            for row in conn.execute(
                "SELECT key, launch_place FROM planning_spaces WHERE launch_place != ?"
                " ORDER BY key",
                (model.LAUNCH_PLACES[0],),
            )
        ]
    _unmet(found, "the spaces")
    return {"launch_place": model.LAUNCH_PLACES[0]}


def _holds_task_projects(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    """Each task names the projects `oracle` read for it, each by its source; a container none."""

    oracle = _oracle(context)
    held: dict[str, set[tuple[str, str]]] = {}
    for identity, project, source in conn.execute(
        "SELECT work_item_id, project_id, source FROM work_item_projects"
    ):
        held.setdefault(str(identity), set()).add((str(project), str(source)))
    references = _references(conn)
    found = [
        f"{references.get(identity, identity)} names {sorted(held.get(identity, set()))},"
        f" not {sorted(oracle.projects.get(identity, set()))}"
        for identity in sorted(set(held) | set(oracle.projects))
        if held.get(identity, set()) != oracle.projects.get(identity, set())
    ]
    _unmet(found, "the items' projects")
    sources = Counter(source for given in held.values() for _, source in given)
    return {"tasks": len(held), "by_source": dict(sorted(sources.items()))}


def _holds_labels_kept(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    """Each item's labels are those before, less the ones its entry drops, in order."""

    oracle = _oracle(context)
    references = _references(conn)
    found = [
        f"{references.get(str(identity), identity)} has the labels {labels},"
        f" not {oracle.labels_after.get(str(identity))}"
        for identity, labels in conn.execute("SELECT work_item_id, labels FROM work_items")
        if json.loads(labels or "[]") != oracle.labels_after.get(str(identity))
    ]
    _unmet(found, "labels")
    return {"items_losing_labels": len(oracle.labels_dropped)}


def _holds_routes(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    oracle = _oracle(context)
    after = {
        str(key): str(record)
        for key, record in conn.execute("SELECT key, record_json FROM platform_ui_prefs")
    }
    kept = {
        key: record for key, record in oracle.ui_prefs.items() if key not in oracle.dropped_prefs
    }
    found = [
        f"{key} carries a project as its scope"
        for key, record in after.items()
        if _project_scoped(record)
    ]
    if after != kept:
        found.append(
            f"the preferences are {sorted(after)}, the oracle expected {sorted(kept)} as they were"
        )
    _unmet(found, "remembered routes")
    return {"dropped": oracle.dropped_prefs, "kept": len(after)}


def _holds_requests_asked(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    oracle = _oracle(context)
    found = [
        f"the request {row[0]} asks the session {row[1]}"
        for row in conn.execute(
            "SELECT request_id, addressee FROM work_item_requests WHERE addressee IS NOT NULL"
        )
    ]
    held = frozenset(
        str(row[0]) for row in conn.execute("SELECT request_id FROM work_item_requests")
    )
    if held != oracle.request_ids:
        found.append(
            f"requests differ: missing {sorted(oracle.request_ids - held)[:5]},"
            f" extra {sorted(held - oracle.request_ids)[:5]}"
        )
    _unmet(found, "requests")
    return {"requests": len(held)}


def _holds_no_old_waiting(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    del context
    if (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (_WAITING,)
        ).fetchone()
        is None
    ):
        raise UnmetError(f"{_WAITING} is missing")
    rows = int(conn.execute(f"SELECT COUNT(*) FROM {_WAITING}").fetchone()[0])  # noqa: S608
    found = [f"{_WAITING} holds {rows} rows, not 0"] if rows else []
    found += [
        f"{_WAITING} row {row[1]} names a missing {row[2]}"
        for row in conn.execute(f"PRAGMA foreign_key_check({_WAITING})")
    ]
    _unmet(found, "words waiting before 3.0")
    return {"rows": rows}


#: The writes `work_item_waiting_notices` must refuse: a scope it does not know, and a
#: delivery that names its call without its time.
_WAITING_REFUSED = (
    ("scope 'other'", {"scope": "other"}),
    ("delivered_call without delivered_at", {"delivered_call": 1}),
)
_WAITING_PROBE = {"work_item_id": "probe", "scope": "tree", "from_call": 0, "created_call": 0}


def _holds_request_shapes(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    expected, _triggers = _fresh_structure(context)
    shape, _ = _structure(conn)
    found = [
        f"{table} differs from a fresh store in its {part.replace('_', ' ')}"
        for table in ("work_item_requests", _WAITING)
        for part in ("columns", "indexes", "foreign_keys")
        if shape.get(table, {}).get(part) != expected.get(table, {}).get(part)
    ]
    for what, change in _WAITING_REFUSED:
        row = {**_WAITING_PROBE, **change}
        conn.execute("SAVEPOINT waiting_probe")
        try:
            conn.execute(
                f"INSERT INTO {_WAITING}({','.join(row)}) VALUES({','.join('?' * len(row))})",
                tuple(row.values()),
            )
            found.append(f"{_WAITING} takes a row with {what}")
        except sqlite3.Error as refused:
            if not str(refused).startswith(work_model_probes.CHECK_FAILED):
                found.append(f"{_WAITING} refuses a row with {what} for another reason: {refused}")
        finally:
            conn.execute("ROLLBACK TO waiting_probe")
            conn.execute("RELEASE waiting_probe")
    _unmet(found, "the requests and the waiting words are not shaped like a fresh store's")
    return {"refused": [what for what, _change in _WAITING_REFUSED]}


def _holds_fresh_tables(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    expected = _expected_counts(_oracle(context))
    declared, _triggers = _fresh_structure(context)
    added = {table: rows for table, rows in _counts(conn).items() if table not in expected}
    found = [
        f"table {table} is not one a fresh store declares"
        for table in added
        if table not in declared
    ]
    found += [f"table {table} holds {rows} rows, not 0" for table, rows in added.items() if rows]
    _unmet(found, "tables the store before the migration lacked")
    return {"added": sorted(added)}


def _holds_requests_kept(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    """Every request keeps its item, kind and status, but those `ended-requests` ended. How
    many there are is `row-counts`'s to compare and which ids `requests-asked`'s, so a lost
    one is refused there."""

    oracle = _oracle(context)
    after = {
        str(row[0]): (str(row[1]), str(row[2]), str(row[3]))
        for row in conn.execute(
            "SELECT request_id, work_item_id, kind, status FROM work_item_requests"
        )
    }
    found = []
    for identity, (item, kind, status) in sorted(oracle.requests.items()):
        now = after.get(identity)
        if now is None:
            continue
        ended = identity in oracle.ended or identity in oracle.lapsed
        expected = (item, kind, "expired" if ended else status)
        if now != expected:
            found.append(f"the request {identity} reads {now}, not {expected}")
    _unmet(found, "requests")
    return {"requests": len(after)}


def _holds_no_closed_waits(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    """No request waits on a closed item, and none says `task_closed`."""

    del context
    found = [
        f"the request {row[0]} waits on a closed item"
        for row in conn.execute(
            f"SELECT r.request_id{_REQUEST_STATES} WHERE s.is_terminal = 1 AND r.status = 'pending'"
        )
    ]
    found += [
        f"the request {row[0]} says task_closed"
        for row in conn.execute(
            "SELECT request_id FROM work_item_requests WHERE expired_reason = 'task_closed'"
        )
    ]
    _unmet(found, "requests on closed items")
    return {"pending_on_closed": 0}


def _holds_requests_ended(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    """The requests a close ended are the ones `oracle` foresaw, each with the reason of its
    item's category, and those that had lapsed say why."""

    oracle = _oracle(context)
    lapsed = {
        str(row[0]): str(row[1])
        for row in conn.execute(
            "SELECT request_id, expired_reason FROM work_item_requests"
            " WHERE request_id IN (SELECT value FROM json_each(?))",
            (json.dumps(sorted(oracle.lapsed)),),
        )
    }
    rows = conn.execute(
        f"SELECT r.request_id, r.expired_reason, s.category{_REQUEST_STATES}"
        " WHERE r.expired_reason IN ('item_completed', 'item_cancelled')"
    ).fetchall()
    held = {str(row[0]): str(row[1]) for row in rows}
    found = []
    if held != oracle.ended:
        found.append(f"the requests a close ended are {held}, not {oracle.ended}")
    found += [
        f"the request {row[0]} says {row[1]} on an item in {row[2]}"
        for row in rows
        if row[1] != questions.closed_reason(str(row[2]))
    ]
    if lapsed != oracle.lapsed:
        found.append(f"the requests that had lapsed read {lapsed}, not {oracle.lapsed}")
    _unmet(found, "requests a close ended")
    return {
        "ended": dict(sorted(Counter(held.values()).items())),
        "lapsed": dict(sorted(Counter(lapsed.values()).items())),
    }


def _p16(conn: sqlite3.Connection, context: Context) -> Mapping[str, Any]:
    again = [step.name for step in context.steps if step.needed(conn, context)]
    _unmet(again, "steps a second run would take")
    return {"steps_needed_again": again}


POSTCONDITIONS = (
    Postcondition("fresh-shape", "the schema and the shape of a fresh store", _p1),
    Postcondition("row-counts", "row counts", _p2),
    Postcondition("integrity", "foreign keys and integrity", _p3),
    Postcondition("no-epic", "no epic; every container accounted for", _p4),
    Postcondition("parents", "parents are containers of the same space, with no cycle", _p5),
    Postcondition("categories", "the eight categories and one service state in every workflow", _p6),
    Postcondition("history-keys", "the history names only current keys", _p7),
    Postcondition("containers-unheld", "containers unheld and in place", _p8),
    Postcondition("holders", "holders and released claims", _p9),
    Postcondition("acceptance", "acceptance", _p10),
    Postcondition("started", "started", _p11),
    Postcondition("derived", "what accepted open containers derive", _p12),
    Postcondition("indexes", "indexes, triggers and the word index", _p13),
    Postcondition("identities", "identities and content", _p14),
    Postcondition("known-exceptions", "known exceptions", _p15),
    Postcondition("store-identity", "the store and each space keep their identity", _p18),
    Postcondition("space-projects", "no space holds a project; each launches in itself", _p19),
    Postcondition("task-projects", "each task names the projects the file and its space give", _p20),
    Postcondition("labels-kept", "each item keeps its labels but the ones its entry drops", _p21),
    Postcondition("routes", "no remembered route has a project as its scope", _p22),
    Postcondition("requests-asked", "every request asks the owner, and none is lost", _p23),
    Postcondition("no-old-waiting", "no words wait from before 3.0", _p24),
    Postcondition("request-shapes", "requests and waiting words shaped as a fresh store's", _p25),
    Postcondition("fresh-tables", "a table the store lacked is declared fresh and empty", _p26),
    Postcondition(
        "requests-kept", "every request keeps its item, kind and status but those a close ended", _p27
    ),
    Postcondition("no-closed-waits", "no request waits on a closed item or says task_closed", _p28),
    Postcondition("requests-ended", "a close ended the requests foreseen, each by its item's category", _p29),
    Postcondition("second-run", "a second run changes nothing", _p16),
)

__all__ = ["AUTHOR", "POSTCONDITIONS", "STEPS", "Oracle", "store_steps"]
