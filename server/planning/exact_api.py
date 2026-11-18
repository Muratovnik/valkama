"""Planning's answers on the exact-scope routes the web shell reads.

`/api/platform/planning` is the portfolio: every space with its projects, how
full each one is and the four numbers of its card (`volumes.portfolio_numbers`),
or every item of one exactly named space.
`/api/modules/planning/work-item` is one work item for the inspector. Search and
human requests answer through `interactions` on the same routing.

Every answer is built from a fresh `PlanningRouting` and is a read: nothing
here writes to the store it reads.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable, Mapping

from ..projects import project_registry, scopes
from ..store_identity.metadata import ScopeError
from ..store_identity.refs import validate_work_item_ref
from ..ui_state import PlatformHttpError, envelope
from . import interactions, item_tree, model, queue, service, states, volumes
from .routing import PlanningRouting, one, scope_parameters

PLANNING_INTERFACE = "valkama-planning"
PLANNING_WORK_ITEM_INTERFACE = "valkama-planning-work-item"

#: What opening a space's store and reading it raise: the attached store is gone or
#: unlisted (`PlanningRouting.store_connection`), it is no store, its identity does not
#: read, or SQLite cannot answer.
_UNREADABLE = (PlatformHttpError, scopes.ScopeError, ScopeError, sqlite3.Error)

PORTFOLIO_PATH = "/api/platform/planning"
WORK_ITEM_PATH = "/api/modules/planning/work-item"
READ_PATHS = frozenset({PORTFOLIO_PATH, WORK_ITEM_PATH, *interactions.READ_PATHS})
WRITE_PATHS = interactions.WRITE_PATHS


def planning_payload(routing: PlanningRouting, parameters: Mapping[str, list[str]]) -> dict:
    """The directory: every space, its projects and how full it is, and what is in it.

    What is *in* a space is Planning's own read model to answer. This one
    exists so global scope can list spaces without every module learning that
    read model. `directory_only` lists the spaces and leaves their items out.
    """

    directory_only = "directory_only" in parameters
    if directory_only:
        if one(parameters, "directory_only") != "true":
            raise PlatformHttpError(400, "error", "directory_only must be true")
        if one(parameters, "scope_kind") != "global":
            raise PlatformHttpError(400, "error", "directory_only requires global scope")
        parameters = {key: values for key, values in parameters.items() if key != "directory_only"}
    scope = scope_parameters(parameters)
    if not routing.registry_available:
        return {
            "interface_version": PLANNING_INTERFACE,
            "scope": scope,
            "state": envelope("unavailable", reason="platform.planning.registryUnavailable"),
        }
    if scope["kind"] == "global":
        listed = routing.present_spaces()
        spaces = [] if directory_only else [_space_view(routing, ref) for ref in listed]
        state = (
            envelope(
                "ready",
                payload={
                    "spaces": [_planning_space(routing, ref) for ref in listed],
                    "planning_spaces": spaces,
                },
            )
            if listed
            else envelope("empty", reason="platform.planning.noSpaces")
        )
        return {"interface_version": PLANNING_INTERFACE, "scope": scope, "state": state}
    routing.require_scope(scope)
    space_ref = scope["space_ref"]
    space = _space_view(routing, space_ref)
    state = (
        envelope(
            "ready",
            payload={
                "spaces": [_planning_space(routing, space_ref)],
                "planning_spaces": [space],
            },
        )
        if space["work_items"]
        else envelope("empty", reason="platform.planning.empty")
    )
    return {"interface_version": PLANNING_INTERFACE, "scope": scope, "state": state}


def _planning_space(routing: PlanningRouting, space_ref: dict) -> dict:
    """One space as the directory lists it: its name, its projects, how many items, and the
    four numbers of its card.

    A store that no longer opens, or does not answer, costs its own spaces alone: each is
    listed by what is known without the store, its key for a name and no count, and the
    directory answers for the others.
    """

    projects = project_registry.projects_shown(routing.space_projects(space_ref))
    try:
        with routing.store_connection(space_ref) as store:
            row = store.execute(
                "SELECT p.planning_space_id, p.key, p.name, COUNT(w.work_item_id) AS held"
                " FROM planning_spaces p"
                " LEFT JOIN work_items w ON w.planning_space_id = p.planning_space_id"
                " WHERE p.key = ? GROUP BY p.planning_space_id",
                (space_ref["space_key"],),
            ).fetchone()
            numbers = (
                None
                if row is None
                else volumes.portfolio_numbers(store, row, listing=routing.projects_result)
            )
    except _UNREADABLE:
        row = None
    if row is None:
        return {
            "space_ref": space_ref,
            "title": space_ref["space_key"],
            "work_item_count": None,
            "numbers": None,
            "numbers_absent": "unreadable",
            **projects,
        }
    return {
        "space_ref": space_ref,
        # The display name is the space's own, kept apart from its identity:
        # renaming it must not move a single binding.
        "title": str(row["name"]),
        "work_item_count": int(row["held"]),
        "numbers": numbers,
        "numbers_absent": "old_store" if numbers is None else None,
        **projects,
    }


def _space_view(routing: PlanningRouting, space_ref: dict) -> dict:
    """One space, summarised. The directory names items; it does not group them.

    The Board era answered here with cards already sorted into six lanes,
    which is why Kanban was the model rather than one view of it.
    """

    with routing.store_connection(space_ref) as store:
        space = store.execute(
            "SELECT planning_space_id, name FROM planning_spaces WHERE key = ?",
            (space_ref["space_key"],),
        ).fetchone()
        if space is None:
            raise PlatformHttpError(409, "unavailable", "Planning space is unavailable")
        rows = store.execute(
            "SELECT w.work_item_id, w.number, w.title, w.priority, w.labels, w.claim_ref,"
            " w.revision, w.updated_at, w.parent_id, w.created_at, s.key, s.name, s.category,"
            " s.is_terminal, s.position AS state_position, ? AS space_key"
            " FROM work_items w JOIN workflow_states s ON s.state_id = w.state_id"
            " WHERE w.planning_space_id = ?",
            (space_ref["space_key"], str(space["planning_space_id"])),
        ).fetchall()
        # What every accepted open goal and stage derives, in one read of the space,
        # and the order every read of many items stands on.
        tree = item_tree.of_spaces(store, [str(space["planning_space_id"])])
        rows.sort(key=lambda row: queue.list_key(row, tree))
        shown = [states.public_state(row) for row in rows]
        work_items = [
            {
                "work_item_ref": {
                    "space_ref": space_ref,
                    "reference": f"{space_ref['space_key']}-{int(row['number'])}",
                },
                "title": row["title"],
                "state_key": state["key"] if state is not None else None,
                "state_category": state["category"] if state is not None else None,
                "container_state": tree.container_state(str(row["work_item_id"])),
                "priority": row["priority"],
                "labels": json.loads(row["labels"]),
                "claim_ref": row["claim_ref"],
                "revision": int(row["revision"]),
                "updated_at": row["updated_at"],
            }
            for row, state in zip(rows, shown, strict=True)
        ]
    return {
        "space_ref": space_ref,
        "title": str(space["name"]),
        "work_items": work_items,
    }


def work_item_payload(
    routing: PlanningRouting,
    parameters: Mapping[str, list[str]],
    item_loader: Callable[[sqlite3.Connection, str], dict],
) -> dict:
    """One work item, read from the store of its exactly named space.

    The record comes from Planning's own service through the loader; this
    function owns the scope. The inspector reads links and
    refs from the work item itself. `brief=true` answers with the brief record
    instead, the one a space's list carries, whose size does not grow with the
    item's history: what a preview of a reference draws.
    """

    brief = "brief" in parameters
    if brief:
        if one(parameters, "brief") != "true":
            raise PlatformHttpError(400, "error", "brief must be true")
        parameters = {key: values for key, values in parameters.items() if key != "brief"}
        item_loader = service.get_work_item_brief
    scope = scope_parameters(parameters, extras=("reference",))
    if scope["kind"] != "space":
        raise PlatformHttpError(400, "error", "Work item reads require exact space scope")
    routing.require_scope(scope)
    space_ref = scope["space_ref"]
    work_item_ref = validate_work_item_ref(
        {"space_ref": space_ref, "reference": one(parameters, "reference")}
    )
    with routing.store_connection(space_ref) as store:
        try:
            work_item = item_loader(store, work_item_ref["reference"])
        except model.StoreSchemaError as error:
            raise PlatformHttpError(409, "unavailable", model.STORE_SCHEMA_MISMATCH) from error
        except (ValueError, KeyError) as error:
            raise PlatformHttpError(404, "unavailable", "Exact work item is unavailable") from error
    return {
        "interface_version": PLANNING_WORK_ITEM_INTERFACE,
        "scope": scope,
        "work_item_ref": work_item_ref,
        "state": envelope(
            "ready",
            payload={"work_item": work_item},
        ),
    }


def handle_get(
    conn: sqlite3.Connection,
    primary_db: str,
    path: str,
    parameters: Mapping[str, list[str]],
    *,
    item_loader: Callable[[sqlite3.Connection, str], dict] | None = None,
    registry_reader: project_registry.RegistryReader | None = None,
) -> tuple[int, dict] | None:
    """Answer one exact-scope read, or return None when the path is not ours."""

    if path not in READ_PATHS:
        return None
    routing = PlanningRouting(conn, primary_db, registry_reader=registry_reader)
    if path == "/api/modules/planning/search":
        return 200, interactions.search(routing, parameters)
    if path == "/api/modules/planning/requests":
        return 200, interactions.request_list(routing, parameters)
    if path == "/api/modules/planning/request":
        return 200, interactions.request_detail(routing, parameters)
    if path == PORTFOLIO_PATH:
        return 200, planning_payload(routing, parameters)
    if item_loader is None:
        raise TypeError("the work item endpoint requires Planning's own loader")
    return 200, work_item_payload(routing, parameters, item_loader)


def handle_post(
    conn: sqlite3.Connection,
    primary_db: str,
    path: str,
    payload: dict,
    *,
    registry_reader: project_registry.RegistryReader | None = None,
) -> tuple[int, dict] | None:
    """Answer one human-request write, or return None when the path is not ours."""

    if path not in WRITE_PATHS:
        return None
    routing = PlanningRouting(conn, primary_db, registry_reader=registry_reader)
    return 200, interactions.request_command(routing, path, payload)
