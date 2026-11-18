"""Mapped Planning search and human-request transport contracts.

Each operation reaches a store only through `PlanningRouting`, so a search or a
request names an exact space, by its store and its key, and never a key alone. A
source is one space: every space of the primary store and of each attached store,
and each space the registry binds a project to in a store that cannot be read,
which a search names as skipped rather than leaves out.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Collection, Mapping

from ..projects import project_registry, scopes
from ..store_identity.metadata import ScopeError
from ..store_identity.primitives import ContractError
from ..store_identity.refs import (
    planning_space_ref,
    planning_work_item_entity,
    route_entity_parameter,
    validate_planning_space_ref,
)
from . import api, model, participation, read_model, requests, service, triage
from .routing import PlanningRouting

READ_PATHS = frozenset(
    {
        "/api/modules/planning/search",
        "/api/modules/planning/requests",
        "/api/modules/planning/request",
    }
)
WRITE_PATHS = frozenset(
    {
        "/api/modules/planning/request",
        "/api/modules/planning/request/answer",
        "/api/modules/planning/request/change",
        "/api/modules/planning/request/decline",
        "/api/modules/planning/request/expire",
    }
)


#: The most results a search answers with: its web schema holds it to the same.
SEARCH_CEILING = 100


def _limit(parameters: Mapping[str, list[str]], default: int, ceiling: int) -> int:
    """The page size a read asked for, from 1 to the read's own `ceiling`."""

    raw = parameters.get("limit", [str(default)])
    if len(raw) != 1 or not _digits(raw[0]) or not 1 <= int(raw[0]) <= ceiling:
        raise api.PlanningHttpError(
            400, "invalid_request", f"limit must be between 1 and {ceiling}"
        )
    return int(raw[0])


def _offset(parameters: Mapping[str, list[str]]) -> int:
    """Where a page starts: how many of the sorted results come before it."""

    raw = parameters.get("offset", ["0"])
    if len(raw) != 1 or not _digits(raw[0]) or int(raw[0]) > model.MAX_COUNT:
        raise api.PlanningHttpError(400, "invalid_request", "offset must be a non-negative integer")
    return int(raw[0])


def _digits(text: str) -> bool:
    # ASCII only: `isdigit` alone passes "²", which `int` then refuses.
    return text.isascii() and text.isdigit()


def _target(routing: PlanningRouting, space_ref: dict, reference: str) -> dict:
    return {
        "space_ref": space_ref,
        "reference": reference,
        "writable": space_ref["data_scope_id"] == routing.metadata["data_scope_id"],
    }


def _resources(routing: PlanningRouting) -> list[dict]:
    """Every source, once: the readable spaces, then the bound spaces no store here holds.

    The primary store's spaces come first, so its item leads a search before an
    attached store's item of the same reference.
    """

    if not routing.registry_available:
        raise api.PlanningHttpError(409, "unavailable", "project_registry_unavailable")
    result = routing.present_spaces()
    absent = []
    for project in routing.projects:
        binding = project.get("planning_binding")
        if binding is None:
            continue
        try:
            space_ref = planning_space_ref(project_registry.binding_entity(binding))
        except (ContractError, KeyError, TypeError) as error:
            raise api.PlanningHttpError(409, "unavailable", "planning_binding_invalid") from error
        if routing.unavailable_reason(space_ref) is not None and space_ref not in absent:
            absent.append(space_ref)
    return result + sorted(absent, key=lambda ref: (ref["data_scope_id"], ref["space_key"]))


def search(routing: PlanningRouting, parameters: Mapping[str, list[str]]) -> dict:
    if set(parameters) - {"q", "limit"} or "q" not in parameters:
        raise api.PlanningHttpError(400, "invalid_request", "search requires q and optional limit")
    query = model.text_field(_one(parameters, "q"), "query", limit=200)
    limit = _limit(parameters, 50, SEARCH_CEILING)
    items: list[dict] = []
    coverage: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    more = False
    for space_ref in _resources(routing):
        entry: dict = {
            "space_ref": space_ref,
            "status": "unavailable",
            "reason": routing.unavailable_reason(space_ref),
        }
        if entry["reason"] is not None:
            coverage.append(entry)
            continue
        # Mapped, so what is left to go wrong is the store itself: it went away
        # between the two reads, or it answers a search this build cannot ask.
        entry["reason"] = "store_unreadable"
        try:
            with routing.planning_store(_store_parameters(space_ref)) as (conn, _key):
                entry["reason"] = "search_failed"
                found = service.search_work_items(
                    conn, query, space=space_ref["space_key"], limit=limit + 1
                )
                more = more or len(found) > limit
                for item in found:
                    identity = (
                        space_ref["data_scope_id"],
                        item["planning_space_id"],
                        item["work_item_id"],
                    )
                    if identity in seen:
                        continue
                    seen.add(identity)
                    items.append(
                        {
                            "target": _target(routing, space_ref, item["reference"]),
                            "item": {
                                "work_item_id": item["work_item_id"],
                                "planning_space_id": item["planning_space_id"],
                                "reference": item["reference"],
                                "title": item["title"],
                                # What a result row marks beside the title: the
                                # kind and priority glyphs and the state's tone.
                                "kind": item["kind"],
                                "priority": item["priority"],
                                "state": None
                                if item["state"] is None
                                else {
                                    "name": item["state"]["name"],
                                    "category": item["state"]["category"],
                                    "is_terminal": item["state"]["is_terminal"],
                                },
                                "open": item["open"],
                                "container_state": item["container_state"],
                                "claim_ref": item["claim_ref"],
                            },
                        }
                    )
            entry.update(status="searched", reason=None)
        except (api.PlanningHttpError, ValueError, sqlite3.Error, KeyError, TypeError):
            pass
        coverage.append(entry)
    items = _exact_first(query, items)
    return {
        "interface_version": "valkama-planning-search",
        "query": query,
        "limit": limit,
        "has_more": more or len(items) > limit,
        "items": items[:limit],
        "coverage": coverage,
    }


def _exact_first(query: str, items: list[dict]) -> list[dict]:
    """The item a query names exactly ahead of the rest, before the page is cut.

    Sources are read space by space, so without this the item `MAIN-12`
    came after every item of an earlier space that merely mentions it. The
    primary store's item leads, an attached store's item of the same reference
    follows it, and every other match keeps the order it was read in. A number
    alone names each source's item of that number: each source puts its own
    first, and this keeps a later source's from falling behind an earlier
    source's mentions.
    """

    if model.exact_reference(query) is None and model.exact_number(query) is None:
        return items

    def rank(entry: dict) -> int:
        if not model.names_exactly(query, entry["item"]["reference"]):
            return 2
        return 0 if entry["target"]["writable"] else 1

    return sorted(items, key=rank)


def work_item_location(routing: PlanningRouting, text: str) -> str | None:
    """The card route of the item a text names, or None when it names no such item.

    The space is the reference's own prefix, and the primary store answers before
    an attached store with the same key, as a search ranks them. Nothing the text
    says reaches the route but a reference the grammar accepted and a store
    confirmed; the route's other parts are the store's identity and the key. Why a
    text led nowhere is the page's to say: it asks the mapped search, which names
    every source it read and every one it could not.
    """

    reference = model.exact_reference(text)
    if reference is None:
        return None
    key = reference.rsplit("-", 1)[0]
    primary = routing.metadata["data_scope_id"]
    sources = [source for source in _resources(routing) if source["space_key"] == key]
    for space_ref in sorted(sources, key=lambda source: source["data_scope_id"] != primary):
        if routing.unavailable_reason(space_ref) is not None:
            continue
        with routing.planning_store(_store_parameters(space_ref)) as (conn, _key):
            # Only whether it is there: the card's own read says if it cannot be read.
            try:
                read_model.item_row(conn, reference)
            except (ValueError, KeyError):
                continue
        entity = planning_work_item_entity({"space_ref": space_ref, "reference": reference})
        return (
            f"/modules/planning/space/{space_ref['data_scope_id']}/{space_ref['space_key']}"
            f"?entity={route_entity_parameter(entity)}"
        )
    return None


def _present_in(conn: sqlite3.Connection, pairs: list[tuple[str, int]]) -> set[str]:
    """Which (space key, number) pairs this store holds, in one indexed statement."""

    if not pairs:
        return set()
    values = ",".join("(?,?)" for _ in pairs)
    rows = conn.execute(
        f"""
        WITH wanted(space_key, number) AS (VALUES {values})
        SELECT wanted.space_key, wanted.number
        FROM wanted
        JOIN planning_spaces ON planning_spaces.key = wanted.space_key
        JOIN work_items
          ON work_items.planning_space_id = planning_spaces.planning_space_id
         AND work_items.number = wanted.number
        """,  # noqa: S608 - only placeholders are interpolated
        [value for pair in pairs for value in pair],
    )
    return {f"{row[0]}-{row[1]}" for row in rows}


def _attached_present(primary_db: str, pairs: list[tuple[str, int]]) -> set[str]:
    """What the attached stores hold of these pairs; one unreadable holds nothing."""

    try:
        attached = [item for item in scopes.load(primary_db) if not item.get("primary")]
    except scopes.ScopeError:
        return set()
    found: set[str] = set()
    for item in attached:
        try:
            store = scopes.open_readonly(item)
            try:
                found |= _present_in(store, pairs)
            finally:
                store.close()
        except (sqlite3.Error, scopes.ScopeError, ScopeError):
            continue
    return found


def existing_references(
    primary: sqlite3.Connection, primary_db: str, references: Collection[str]
) -> set[str]:
    """Which of these references `work_item_location` leads to a card, read together.

    The same rule without its per-reference cost, for a caller holding many candidates
    and a client waiting: the registry is readable, and a store here holds the item.
    The primary store answers in one statement. An attached store is opened only for
    a candidate the primary store does not hold, so with every candidate at home no
    other file is touched.
    """

    if project_registry.read_registry()["status"] != "available":
        return set()
    pairs = [
        (key, int(number)) for key, number in (reference.rsplit("-", 1) for reference in references)
    ]
    if not pairs:
        return set()
    found = _present_in(primary, pairs)
    outstanding = [pair for pair in pairs if f"{pair[0]}-{pair[1]}" not in found]
    if outstanding:
        found |= _attached_present(primary_db, outstanding)
    return found


def _exact_parameters(parameters: Mapping[str, list[str]], extras: set[str]) -> dict:
    """The space an exact request names: `scope_kind=space`, its store and its key."""

    required = {"scope_kind", "data_scope_id", "space_key", *extras}
    if set(parameters) != required or _one(parameters, "scope_kind") != "space":
        raise api.PlanningHttpError(400, "invalid_request", "exact_space_fields_required")
    return validate_planning_space_ref(
        {
            "data_scope_id": _one(parameters, "data_scope_id"),
            "space_key": _one(parameters, "space_key"),
        }
    )


def _request_item(conn: sqlite3.Connection, record: dict, key: str) -> None:
    item = read_model.item_by_id(conn, record["work_item_id"])
    if item["planning_space_id"] != read_model.space_identity(conn, key):
        raise api.PlanningHttpError(409, "unavailable", "request_outside_planning_space")


def _capability(conn: sqlite3.Connection) -> None:
    if (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='work_item_requests'"
        ).fetchone()
        is None
    ):
        raise api.PlanningHttpError(409, "unavailable", "requests_unavailable")


def request_detail(routing: PlanningRouting, parameters: Mapping[str, list[str]]) -> dict:
    space_ref = _exact_parameters(parameters, {"id"})
    with routing.planning_store(_store_parameters(space_ref)) as (conn, _key):
        _capability(conn)
        record = requests.get(conn, _one(parameters, "id"))
        _request_item(conn, record, space_ref["space_key"])
    return {
        "interface_version": "valkama-planning-requests",
        "target": _target(routing, space_ref, record["reference"]),
        "request": record,
    }


def request_list(routing: PlanningRouting, parameters: Mapping[str, list[str]]) -> dict:
    """One page of the questions of every source, or of one space or item, newest first.

    Each source is read whole, so the page is cut from the sorted list of all of them
    and `total` counts them all; the answer stays one page however many there are,
    and a reader takes the next from `offset` while `has_more` says so.

    Beside the questions stands `triage_due`: a line for each space read whose stack
    of triage waits past the owner's thresholds (`triage.due`). It is no question, so
    it is no item, counts in no total and takes no answer. It belongs to the list as
    a whole, not to a page: only the first page reads it, and a read of answered or
    closed questions, or of one item's, has none.
    """

    limit = _limit(parameters, 100, requests.PAGE)
    offset = _offset(parameters)
    status = _one(parameters, "status") if "status" in parameters else None
    if status is not None:
        model.enum_field(
            status, frozenset({"pending", "answered", "declined", "expired"}), "status"
        )
    scoped = {
        key: value for key, value in parameters.items() if key not in {"limit", "offset", "status"}
    }
    scope_kind = _one(scoped, "scope_kind")
    reference = None
    if scope_kind == "global":
        if set(scoped) != {"scope_kind"}:
            raise api.PlanningHttpError(400, "invalid_request", "global_scope_fields_invalid")
        resources = _resources(routing)
    else:
        reference = _one(scoped, "reference") if "reference" in scoped else None
        space_ref = _exact_parameters(scoped, {"reference"} if reference is not None else set())
        resources = [space_ref]
    reminds = offset == 0 and status in {None, "pending"} and reference is None
    items: list[dict] = []
    coverage: list[dict] = []
    due: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for space_ref in resources:
        # A global read names why a source was skipped; an exact one refuses
        # below with the routing's own answer instead.
        skipped = routing.unavailable_reason(space_ref) if scope_kind == "global" else None
        entry: dict = {
            "space_ref": space_ref,
            "status": "unavailable",
            "reason": skipped or "requests_unavailable",
        }
        if skipped is not None:
            coverage.append(entry)
            continue
        try:
            with routing.planning_store(_store_parameters(space_ref)) as (conn, _key):
                _capability(conn)
                found = _every_request(conn, space_ref["space_key"], status, reference)
                for record in found:
                    identity = (space_ref["data_scope_id"], record["request_id"])
                    if identity not in seen:
                        seen.add(identity)
                        items.append(
                            {
                                "target": _target(routing, space_ref, record["reference"]),
                                "request": record,
                            }
                        )
                line = (
                    triage.due(
                        conn,
                        participation.load(conn),
                        read_model.space_identity(conn, space_ref["space_key"]),
                    )
                    if reminds
                    else None
                )
            entry.update(status="searched", reason=None)
            if line is not None:
                due.append(line)
        except (api.PlanningHttpError, ValueError, sqlite3.Error, KeyError, TypeError):
            if scope_kind != "global":
                raise
        coverage.append(entry)
    items.sort(
        key=lambda entry: (entry["request"]["created_at"], entry["request"]["request_id"]),
        reverse=True,
    )
    return {
        "interface_version": "valkama-planning-requests",
        "items": items[offset : offset + limit],
        "coverage": coverage,
        "limit": limit,
        "total": len(items),
        "has_more": offset + limit < len(items),
        "triage_due": due,
    }


def _every_request(
    conn: sqlite3.Connection, space: str, status: str | None, reference: str | None
) -> list[dict]:
    """Every request of one space the filters keep, read a page at a time.

    Without an item this is what waits for the person, and a list on a comment
    waits for nobody: it is read with its item, under its comment.
    """

    found: list[dict] = []
    offset = 0
    while True:
        page = requests.list_page(
            conn,
            space=space,
            status=status,
            reference=reference,
            lists=reference is not None,
            limit=requests.PAGE,
            offset=offset,
        )
        found.extend(page["requests"])
        if page["next_offset"] is None:
            return found
        offset = int(page["next_offset"])


def request_command(routing: PlanningRouting, path: str, payload: dict) -> dict:
    scope_fields = {"data_scope_id", "space_key"}
    base = path == "/api/modules/planning/request"
    operation_fields = (
        {"id", "kind", "prompt", "fields", "author", "execution_id", "session_id", "expires_at"}
        if base
        else {"id", "expected_revision", "author"}
    )
    # A change of an answer takes what the answer took.
    answering = path.endswith(("/answer", "/change"))
    if answering:
        operation_fields |= {"answers", "own", "field_notes", "note"}
    required = scope_fields | (
        {"id", "kind", "prompt", "fields"} if base else {"id", "expected_revision"}
    )
    if answering:
        required.add("answers")
    if set(payload) - (scope_fields | operation_fields) or not required <= set(payload):
        raise api.PlanningHttpError(
            400, "invalid_request", "request body has missing or unknown fields"
        )
    parameters = {key: [payload[key]] for key in scope_fields}
    parameters["scope_kind"] = ["space"]
    with routing.conn:
        if not routing.conn.in_transaction:
            routing.conn.execute("BEGIN IMMEDIATE")
        space_ref = _exact_parameters(parameters, set())
        if space_ref["data_scope_id"] != routing.metadata["data_scope_id"]:
            raise api.PlanningHttpError(409, "unavailable", "attached_store_readonly")
        with routing.planning_store(_store_parameters(space_ref)) as (conn, _key):
            _capability(conn)
            operation = {key: value for key, value in payload.items() if key not in scope_fields}
            if base:
                item = service.get_work_item(
                    conn, model.text_field(operation.get("id"), "id", limit=128)
                )
                if item["planning_space_id"] != read_model.space_identity(
                    conn, space_ref["space_key"]
                ):
                    raise api.PlanningHttpError(409, "unavailable", "item_outside_planning_space")
                route = "/api/planning/work-item/request"
            else:
                record = requests.get(conn, model.text_field(operation.get("id"), "id", limit=128))
                _request_item(conn, record, space_ref["space_key"])
                route = "/api/planning/request/" + path.rsplit("/", 1)[1]
            answer = api.handle_post(conn, route, operation)
            if answer is None:
                raise api.PlanningHttpError(400, "invalid_request", "unknown_request_operation")
            record = answer[1]
    return {
        "interface_version": "valkama-planning-requests",
        "target": _target(routing, space_ref, record["reference"]),
        "request": record,
    }


def _one(parameters: Mapping[str, list[str]], name: str) -> str:
    values = parameters.get(name)
    if (
        not isinstance(values, list)
        or len(values) != 1
        or not isinstance(values[0], str)
        or not values[0]
    ):
        raise api.PlanningHttpError(400, "invalid_request", f"{name} must occur exactly once")
    return values[0]


def _store_parameters(space_ref: dict) -> dict[str, list[str]]:
    return {
        "data_scope_id": [space_ref["data_scope_id"]],
        "space_key": [space_ref["space_key"]],
    }
