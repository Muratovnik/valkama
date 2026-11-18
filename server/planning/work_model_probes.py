"""The trial writes the work-model migration's `fresh-shape` learns a store's constraints from.

`PRAGMA` reads give a table's columns, indexes and foreign keys, but neither its
CHECK constraints nor what a trigger does, so `fresh-shape` learns those by writing. Each
probe is one write, after the setup it needs, in a savepoint that is rolled back.
It runs on a fresh store of this build and on the migrated one, with foreign keys
off on both so that a probe row needs no parent, and each store must answer as the
probe says. A fresh store that answers otherwise means the probe is wrong, and
that is reported too.

The CHECK probes are read off the fresh store's own declarations, so a clause added
to the schema is probed without a change here, or reported when it cannot be:

- a clause `column IN (...)`, `column IS NULL OR column IN (...)` or
  `column = value` is probed with every value it names, each of which must be
  taken, and with one outside them, which must be refused. A forbidden value alone
  cannot tell the declared list from a narrowed one, which refuses it just the same;
- any other clause names its probes, by its text, in `_WRITTEN`;
- the values the work model retired (`_RETIRED`) must be refused as well, since a
  list widened back to them still takes every value the fresh one names;
- a clause no probe covers, or a table with a clause and no row in `_ROWS`, is a
  problem: a CHECK nobody probes fails the migration instead of passing unseen.

Each table's clauses are counted on both stores as well, so one the migrated store
holds and a fresh store does not is seen, though no probe could know to ask for it.

The trigger that keeps each kind where it may stand is probed in both halves: the
writes its insert half must refuse and the moves its update half must.
"""

from __future__ import annotations

import re
import sqlite3
from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from . import model

_Statement = tuple[str, tuple[object, ...]]

#: What SQLite's refusal of a CHECK starts with; the clause's own text follows it.
CHECK_FAILED = "CHECK constraint failed: "
#: What the two halves of `work_items_state_fits_kind` refuse with: two rules of a
#: kind's states and the rule of a basis.
TASK_IN_SERVICE = "only a container stands in the service state"
CONTAINER_AT_WORK = "a container never stands in ready, active, review or blocked"
ACCEPTED_WITHOUT_BASIS = "accepted work stands only with the basis it was accepted on"


class _New:
    """Stands in a probe row for a value that is a new id in every probe."""


_NEW = _New()

#: For each table with a CHECK, a row every one of its clauses takes and nothing
#: else refuses: the same row with one value changed is what a probe writes. Ids
#: are new in each probe, and a fixed key such as a singleton's is replaced, since
#: the write is `INSERT OR REPLACE`, so no row a store already holds collides.
_ROWS: dict[str, dict[str, object]] = {
    "analytics_surface_uses": {"day": "0001-01-01", "kind": "page_open", "count": 1},
    "commits": {"project_id": _NEW, "hash": "0" * 40, "reported_at": "probe"},
    "execution_sessions": {"execution_id": _NEW, "session_id": _NEW, "relation": "launched"},
    "executions": {
        "execution_id": _NEW,
        "work_item_id": _NEW,
        "client_family": "probe",
        "role": "probe",
        "environment": "probe",
        "expected_effect": "probe",
        "status": "starting",
    },
    "owner_alert_settings": {"key": "settings", "record_json": "{}", "updated_at": "probe"},
    "planning_spaces": {
        "planning_space_id": _NEW,
        "name": _NEW,
        "key": _NEW,
    },
    "platform_store_metadata": {
        "singleton": 1,
        "data_scope_id": _NEW,
        "owner_id": "probe",
        "is_primary": 0,
        "is_writable": 0,
        "created_at": "probe",
    },
    "platform_ui_prefs": {"key": "last-route", "record_json": "{}", "updated_at": "probe"},
    "quota_account_names": {"organization": _NEW, "name": "probe", "updated_at": "probe"},
    "quota_alerts": {
        "organization": _NEW,
        "seat": "probe",
        "kind": "five_hour",
        "model": "",
        "resets_at": "probe",
        "level": "75",
        "sample_at": "probe",
        "raised_at": "probe",
    },
    "quota_samples": {
        "at": "probe",
        "source": "statusline",
        "session_id": _NEW,
        "kind": "five_hour",
        "percent": 1.0,
    },
    "quota_settings": {"key": "poll", "record_json": "{}", "updated_at": "probe"},
    "session_events": {"session_id": _NEW, "klass": "analytics", "kind": "probe"},
    "sessions": {"id": _NEW, "client": "probe"},
    "usage_runs": {"session_id": _NEW, "client": "probe", "path": "probe"},
    "usage_segments": {
        "run_id": 0,
        "session_id": _NEW,
        "started_at": "probe",
        "ended_at": "probe",
        "seconds": 0.0,
        "quality": "observed",
    },
    "work_item_baselines": {
        "work_item_id": _NEW,
        "tasks": 0,
        "basis": "accepted",
        "taken_at": "probe",
    },
    "work_item_comments": {"work_item_id": _NEW, "body": "probe"},
    "work_item_commits": {"work_item_id": _NEW, "commit_id": 0, "attached_by": "server"},
    "work_item_deferrals": {
        "work_item_id": _NEW,
        "until_at": "2026-12-01T00:00:00Z",
        "reason": "probe",
        "since": "probe",
    },
    "work_item_events": {"work_item_id": _NEW, "action": "created"},
    "work_item_images": {
        "work_item_id": _NEW,
        "sha256": "0" * 64,
        "media_type": "image/png",
        "size": 1,
    },
    "work_item_links": {"from_id": _NEW, "to_id": _NEW, "kind": "blocks"},
    "work_item_projects": {"work_item_id": _NEW, "project_id": _NEW, "source": "named"},
    "work_item_refs": {"work_item_id": _NEW, "kind": "url", "value": "probe"},
    "work_item_request_answers": {
        "request_id": _NEW,
        "version": 1,
        "answers_json": "{}",
        "answered_by": "probe",
        "answered_at": "probe",
    },
    "work_item_requests": {
        "request_id": _NEW,
        "work_item_id": _NEW,
        "kind": "question",
        "prompt": "probe",
        "fields_json": "[]",
        "author": "probe",
        "created_at": "probe",
    },
    "work_item_search_rows": {"work_item_id": _NEW},
    "work_item_subscriptions": {
        "work_item_id": _NEW,
        "session_id": _NEW,
        "follows": 0,
        "call_id": 0,
    },
    "work_item_waiting_notices": {
        "work_item_id": _NEW,
        "scope": "tree",
        "from_call": 0,
        "created_call": 0,
    },
    "work_items": {
        "work_item_id": _NEW,
        "planning_space_id": _NEW,
        "number": 1,
        "workflow_id": _NEW,
        "state_id": _NEW,
        "title": "probe",
    },
    "workflow_states": {
        "state_id": _NEW,
        "workflow_id": _NEW,
        "key": "probe",
        "name": "probe",
        "category": "triage",
        "position": 0,
    },
}

_Values = tuple[dict[str, object], ...]

_POLLED: dict[str, object] = {"organization": "probe", "session_id": None}

#: The probes of each clause no listed form covers, by table and the clause's text:
#: the changes to the table's row that it must refuse, and those it must take.
_WRITTEN: dict[tuple[str, str], tuple[_Values, _Values]] = {
    (
        "analytics_surface_uses",
        "day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'",
    ): (({"day": "1-01-01"},), ()),
    ("analytics_surface_uses", "typeof(count) = 'integer' AND count > 0"): (
        ({"count": 0}, {"count": 1.5}),
        (),
    ),
    ("commits", "length(hash) BETWEEN 7 AND 64 AND hash NOT GLOB '*[^0-9a-f]*'"): (
        ({"hash": "0" * 6}, {"hash": "0" * 65}, {"hash": "A" * 40}),
        ({"hash": "0" * 7}, {"hash": "f" * 64}),
    ),
    ("planning_spaces", "next_number >= 1"): (({"next_number": 0},), ({"next_number": 1},)),
    ("quota_account_names", "length(organization) BETWEEN 1 AND 512"): (
        ({"organization": ""}, {"organization": "o" * 513}),
        ({"organization": "o" * 512},),
    ),
    ("quota_account_names", "length(name) BETWEEN 1 AND 80"): (
        ({"name": ""}, {"name": "n" * 81}),
        ({"name": "n" * 80},),
    ),
    ("quota_alerts", "(kind = 'week_model') = (model != '')"): (
        ({"kind": "week_model"}, {"model": "probe"}),
        ({"kind": "week_model", "model": "probe"},),
    ),
    ("quota_samples", "(source IN ('poll', 'import')) = (organization IS NOT NULL)"): (
        ({"source": "poll"}, _POLLED),
        ({"source": "poll", **_POLLED},),
    ),
    ("quota_samples", "(organization IS NULL) = (session_id IS NOT NULL)"): (
        ({"session_id": None},),
        (),
    ),
    ("quota_samples", "account_uuid IS NULL OR organization IS NOT NULL"): (
        ({"account_uuid": "probe"},),
        ({"account_uuid": "probe", "source": "poll", **_POLLED},),
    ),
    ("quota_samples", "(kind = 'week_model') = (model IS NOT NULL)"): (
        ({"model": "probe"}, {"kind": "week_model"}),
        ({"kind": "week_model", "model": "probe"},),
    ),
    (
        "quota_samples",
        "kind IN ('extra_usage', 'spend_limit') OR (amount IS NULL AND currency IS NULL)",
    ): (
        ({"amount": 1.0}, {"currency": "EUR"}),
        ({"kind": "spend_limit", "amount": 1.0, "currency": "EUR"},),
    ),
    ("quota_samples", "percent IS NOT NULL OR amount IS NOT NULL"): (
        ({"percent": None},),
        ({"percent": None, "kind": "extra_usage", "amount": 1.0},),
    ),
    ("work_item_request_answers", "version >= 1"): (({"version": 0},), ()),
    ("work_item_images", "length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'"): (
        ({"sha256": "0" * 63}, {"sha256": "A" * 64}),
        ({"sha256": "f" * 64},),
    ),
    ("work_item_images", "size BETWEEN 1 AND 10485760"): (
        ({"size": 0}, {"size": 10485761}),
        ({"size": 10485760},),
    ),
    ("work_items", "number >= 1"): (({"number": 0},), ()),
    ("work_item_baselines", "tasks >= 0"): (({"tasks": -1},), ({"tasks": 3},)),
    ("work_item_deferrals", "(until_at IS NULL) <> (until_item_id IS NULL)"): (
        ({"until_at": None}, {"until_item_id": "probe"}),
        ({"until_at": None, "until_item_id": "probe"},),
    ),
    ("work_item_waiting_notices", "(delivered_call IS NULL) = (delivered_at IS NULL)"): (
        ({"delivered_call": 1}, {"delivered_at": "probe"}),
        ({"delivered_call": 1, "delivered_at": "probe"},),
    ),
}

#: A listed value another clause of the row ties to a second column, with the
#: change that lets the row take it.
_TAKEN_WITH: dict[tuple[str, str, object], dict[str, object]] = {
    ("quota_alerts", "kind", "week_model"): {"model": "probe"},
    ("quota_samples", "kind", "week_model"): {"model": "probe"},
    ("quota_samples", "source", "poll"): _POLLED,
    ("quota_samples", "source", "import"): _POLLED,
}

#: Values a store before the work model held, which a fresh one refuses.
_RETIRED: dict[tuple[str, str], tuple[object, ...]] = {
    ("workflow_states", "category"): ("backlog", "queued"),
    ("work_items", "kind"): ("epic",),
    ("work_item_refs", "kind"): ("commit",),
    ("work_item_requests", "expired_reason"): ("task_closed",),
}

_LITERAL = r"'(?:[^']|'')*'|-?\d+"
_LIST = rf"\(\s*((?:{_LITERAL})(?:\s*,\s*(?:{_LITERAL}))*)\s*\)"
_IN = re.compile(rf"(\w+)\s+IN\s*{_LIST}", re.IGNORECASE)
_NULL_OR_IN = re.compile(rf"(\w+)\s+IS\s+NULL\s+OR\s+\1\s+IN\s*{_LIST}", re.IGNORECASE)
_EQUALS = re.compile(rf"(\w+)\s*=\s*({_LITERAL})")
_CHECK = re.compile(r"CHECK\s*\(", re.IGNORECASE)


@dataclass(frozen=True)
class Probe:
    """One write and how each store must answer it.

    `fresh` is the refusal a fresh store gives, word for word, or None when it takes
    the write; `migrated` is what the migrated store's refusal must hold, or None
    when it must take it. A CHECK is held only to being the CHECK that refuses: a
    rebuilt table may write its clause with other spaces, and the probes that must
    be taken already show the rest of the row passes. `setup` must be taken.
    """

    what: str
    write: _Statement
    fresh: str | None
    migrated: str | None
    setup: tuple[_Statement, ...] = ()


# -- the clauses a store declares -----------------------------------------------


def _past_quote(sql: str, start: int) -> int:
    """The index after the quoted text opening at `start`, a doubled quote kept inside."""

    quote = "]" if sql[start] == "[" else sql[start]
    at = start + 1
    while True:
        at = sql.index(quote, at) + 1
        if quote == "]" or not sql.startswith(quote, at):
            return at
        at += 1


def _skipped(sql: str, at: int) -> int | None:
    """Where a quoted text or a comment opening at `at` ends; None when none opens there."""

    if sql[at] in "'\"`[":
        return _past_quote(sql, at)
    if sql.startswith("--", at):
        end = sql.find("\n", at)
        return len(sql) if end < 0 else end + 1
    if sql.startswith("/*", at):
        return sql.index("*/", at) + 2
    return None


def _closing(sql: str, opening: int) -> int:
    """The index of the parenthesis that closes the one at `opening`."""

    depth, at = 0, opening
    while True:
        past = _skipped(sql, at)
        if past is not None:
            at = past
            continue
        if sql[at] == "(":
            depth += 1
        elif sql[at] == ")":
            depth -= 1
            if depth == 0:
                return at
        at += 1


def clauses(sql: str) -> list[str]:
    """The text inside each `CHECK(...)` of one `CREATE TABLE`, as SQLite names it when
    the clause refuses a write."""

    found: list[str] = []
    at = 0
    while at < len(sql):
        past = _skipped(sql, at)
        if past is not None:
            at = past
            continue
        check = _CHECK.match(sql, at)
        if check is not None and not (at and (sql[at - 1].isalnum() or sql[at - 1] == "_")):
            end = _closing(sql, check.end() - 1)
            found.append(sql[check.end() : end].strip())
            at = end + 1
            continue
        at += 1
    return found


def declared(conn: sqlite3.Connection) -> dict[str, list[str]]:
    """Every table's CHECK clauses, by table; a table with none is left out."""

    found: dict[str, list[str]] = {}
    for name, sql in conn.execute(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL"
        " AND substr(name, 1, 7) != 'sqlite_' ORDER BY name"
    ):
        listed = clauses(str(sql))
        if listed:
            found[str(name)] = listed
    return found


# -- the probes ------------------------------------------------------------------


def _value(literal: str) -> object:
    return literal[1:-1].replace("''", "'") if literal.startswith("'") else int(literal)


def _listed(clause: str) -> tuple[str, list[object], bool] | None:
    """The column a listed clause names, the values it takes and whether it takes NULL;
    None for a clause of another form."""

    for pattern, null in ((_IN, False), (_NULL_OR_IN, True)):
        match = pattern.fullmatch(clause)
        if match is not None:
            values = [_value(literal) for literal in re.findall(_LITERAL, match[2])]
            return match[1], values, null
    match = _EQUALS.fullmatch(clause)
    if match is not None:
        return match[1], [_value(match[2])], False
    return None


def _outside(values: Iterable[object]) -> object:
    """A value none of `values` is, of their kind."""

    listed = list(values)
    numbers = [value for value in listed if isinstance(value, int)]
    if len(numbers) == len(listed):
        return max(numbers) + 1
    return "probe-unlisted"


def _insert(table: str, values: Mapping[str, object]) -> _Statement:
    row = {**_ROWS[table], **values}
    columns = ", ".join(row)
    marks = ", ".join("?" * len(row))
    return (
        f'INSERT OR REPLACE INTO "{table}"({columns}) VALUES({marks})',
        tuple(model.new_id() if value is _NEW else value for value in row.values()),
    )


def _check_probes(table: str, clause: str) -> list[Probe] | None:
    """The probes of one clause, None when no form covers it."""

    refused = CHECK_FAILED + clause
    shown = f"{table} CHECK({clause})"
    listed = _listed(clause)
    if listed is not None:
        column, values, null = listed
        taken: list[dict[str, object]] = [
            {column: value, **_TAKEN_WITH.get((table, column, value), {})} for value in values
        ]
        if null:
            taken.append({column: None})
        forbidden = [_outside(values), *_RETIRED.get((table, column), ())]
        refusing: list[dict[str, object]] = [{column: value} for value in forbidden]
    elif (table, clause) in _WRITTEN:
        written = _WRITTEN[(table, clause)]
        refusing, taken = list(written[0]), list(written[1])
    else:
        return None
    probes = [
        Probe(f"{shown} with {change}", _insert(table, change), None, None) for change in taken
    ]
    probes += [
        Probe(f"{shown} with {change}", _insert(table, change), refused, CHECK_FAILED)
        for change in refusing
    ]
    return probes


def _trigger_probes() -> list[Probe]:
    """Each half of the trigger that keeps a kind where it may stand: a write it must
    refuse, and one it must take."""

    workflow = model.new_id()
    states = {category: model.new_id() for category in ("triage", "ready", "container")}
    setup = tuple(
        (
            "INSERT INTO workflow_states(state_id,workflow_id,key,name,category,position)"
            " VALUES(?,?,?,?,?,?)",
            (state, workflow, category, category, category, position),
        )
        for position, (category, state) in enumerate(states.items())
    )

    def item(kind: str, category: str, basis: str | None = "owner") -> tuple[str, _Statement]:
        identity = model.new_id()
        return identity, (
            "INSERT INTO work_items(work_item_id,planning_space_id,number,workflow_id,state_id,"
            "kind,title,acceptance) VALUES(?,?,1,?,?,?,'probe',?)",
            (identity, model.new_id(), workflow, states[category], kind, basis),
        )

    def moved(
        kind: str, category: str, column: str, value: object, basis: str | None = "owner"
    ) -> tuple[_Statement, ...]:
        identity, inserted = item(kind, category, basis)
        return (
            inserted,
            (
                f"UPDATE work_items SET {column} = ? WHERE work_item_id = ?",  # noqa: S608 - one of three names
                (value, identity),
            ),
        )

    probes = []
    for what, statements, refusal in (
        ("inserting a task into triage", (item("task", "triage", None)[1],), None),
        (
            "inserting a container into the service state",
            (item("container", "container")[1],),
            None,
        ),
        (
            "inserting a task into the service state",
            (item("task", "container")[1],),
            TASK_IN_SERVICE,
        ),
        ("inserting a container into ready", (item("container", "ready")[1],), CONTAINER_AT_WORK),
        (
            "inserting a task into ready with no basis",
            (item("task", "ready", None)[1],),
            ACCEPTED_WITHOUT_BASIS,
        ),
        (
            "inserting a container into the service state with no basis",
            (item("container", "container", None)[1],),
            ACCEPTED_WITHOUT_BASIS,
        ),
        ("moving a task to ready", moved("task", "triage", "state_id", states["ready"]), None),
        (
            "moving a task to ready with no basis",
            moved("task", "triage", "state_id", states["ready"], None),
            ACCEPTED_WITHOUT_BASIS,
        ),
        (
            "erasing the basis of a task in ready",
            moved("task", "ready", "acceptance", None),
            ACCEPTED_WITHOUT_BASIS,
        ),
        (
            "moving a task into the service state",
            moved("task", "triage", "state_id", states["container"]),
            TASK_IN_SERVICE,
        ),
        (
            "moving a container to ready",
            moved("container", "triage", "state_id", states["ready"]),
            CONTAINER_AT_WORK,
        ),
        (
            "making a task in ready a container",
            moved("task", "ready", "kind", model.CONTAINER_KIND),
            CONTAINER_AT_WORK,
        ),
    ):
        probes.append(Probe(what, statements[-1], refusal, refusal, setup + statements[:-1]))
    return probes


def probes(fresh: Mapping[str, list[str]]) -> tuple[list[Probe], list[str]]:
    """The probes of every clause `fresh` declares and of the trigger, and what no probe
    covers: a table with a clause and no row, or a clause of no form."""

    found: list[Probe] = []
    unprobed: list[str] = []
    for table, listed in sorted(fresh.items()):
        if table not in _ROWS:
            unprobed.append(f"{table} has CHECK clauses and no probe row")
            continue
        found.append(Probe(f"{table} with its probe row", _insert(table, {}), None, None))
        for clause in listed:
            covered = _check_probes(table, clause)
            if covered is None:
                unprobed.append(f"no probe tries {table} CHECK({clause})")
            else:
                found += covered
    return found + _trigger_probes(), unprobed


# -- the run ---------------------------------------------------------------------


def _answer(conn: sqlite3.Connection, probe: Probe) -> str | None:
    """None when `conn` takes the probe's write, or the refusal; every write taken back."""

    conn.execute("SAVEPOINT work_model_probe")
    try:
        for statement in probe.setup:
            try:
                conn.execute(*statement)
            except sqlite3.Error as error:
                return f"the setup was refused: {error}"
        try:
            conn.execute(*probe.write)
        except sqlite3.Error as error:
            return str(error) or type(error).__name__
        return None
    finally:
        conn.execute("ROLLBACK TO work_model_probe")
        conn.execute("RELEASE work_model_probe")


def _said(answer: str | None) -> str:
    return "taken" if answer is None else f"refused ({answer})"


def probe(conn: sqlite3.Connection, fresh: sqlite3.Connection) -> list[str]:
    """What the migrated store `conn` answers otherwise than a fresh store `fresh` and
    the probes say; an empty list when nothing does. Both run with foreign keys off."""

    problems = [
        f"foreign keys are enforced on the {which} store, so a probe row lacks its parents"
        for which, store in (("migrated", conn), ("fresh", fresh))
        if store.execute("PRAGMA foreign_keys").fetchone()[0]
    ]
    if problems:
        return problems
    expected = declared(fresh)
    held = declared(conn)
    problems += [
        f"{table} declares {len(held.get(table, []))} CHECK clauses, a fresh store"
        f" {len(expected.get(table, []))}"
        for table in sorted(set(expected) | set(held))
        if len(held.get(table, [])) != len(expected.get(table, []))
    ]
    found, unprobed = probes(expected)
    problems += unprobed
    # Outside a transaction each savepoint would be one of its own, writing the
    # journal every time; inside one, a few hundred probes take milliseconds.
    opened = [store for store in (conn, fresh) if not store.in_transaction]
    for store in opened:
        store.execute("BEGIN")
    try:
        problems += _compare(conn, fresh, found)
    finally:
        for store in opened:
            store.rollback()
    return problems


def _compare(conn: sqlite3.Connection, fresh: sqlite3.Connection, found: list[Probe]) -> list[str]:
    problems: list[str] = []
    for each in found:
        answer = _answer(fresh, each)
        if answer != each.fresh:
            problems.append(f"the probe is wrong: a fresh store has {each.what} {_said(answer)}")
        answer = _answer(conn, each)
        if each.migrated is None:
            if answer is not None:
                problems.append(f"{each.what} is {_said(answer)}, a fresh store takes it")
        elif answer is None:
            problems.append(f"{each.what} is taken, a fresh store refuses it")
        elif each.migrated not in answer:
            problems.append(f"{each.what} is {_said(answer)}, not as a fresh store refuses it")
    return problems
