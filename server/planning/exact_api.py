"""Planning's answers on the exact-scope routes the web shell reads.

`/api/platform/planning` is the portfolio: which project binds which space and
how full each one is, or every item of one exactly named space.
`/api/modules/planning/work-item` is one work item for the inspector. Search and
human requests answer through `interactions` on the same routing.

Every answer is built from a fresh `PlanningRouting` and is a read: nothing
here writes to the store it reads.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable, Mapping

from ..platform import module_gate
from ..projects import project_registry
from ..store_identity.refs import planning_space_ref, validate_work_item_ref
from ..ui_state import PlatformHttpError, envelope
from . import interactions
from .routing import PlanningRouting, one, scope_parameters, space_ref_parameters

PLANNING_INTERFACE = "valkama-planning"
PLANNING_WORK_ITEM_INTERFACE = "valkama-planning-work-item"
#: The registry's relation read model, which this route still carries empty so
#: the browser's contract for it holds until both sides drop the key.
RELATIONS_INTERFACE = "valkama-relations"

PORTFOLIO_PATH = "/api/platform/planning"
WORK_ITEM_PATH = "/api/modules/planning/work-item"
READ_PATHS = frozenset({PORTFOLIO_PATH, WORK_ITEM_PATH, *interactions.READ_PATHS})
WRITE_PATHS = interactions.WRITE_PATHS


def planning_payload(routing: PlanningRouting, parameters: Mapping[str, list[str]]) -> dict:
    """The directory: which project binds which space, and how full.

    What is *in* a space is Planning's own read model to answer. This one
    exists so global scope can list projects and spaces without every module
    learning that read model.
    """

    directory_only = "directory_only" in parameters
    if directory_only:
        if one(parameters, "directory_only") != "true":
            raise PlatformHttpError(400, "error", "directory_only must be true")
        if one(parameters, "scope_kind") != "global":
            raise PlatformHttpError(400, "error", "directory_only requires global scope")
        parameters = {key: values for key, values in parameters.items() if key != "directory_only"}
    scope = scope_parameters(parameters, project_extras=("data_scope_id", "space_key"))
    if routing.projects_result["status"] != "available":
        return {
            "interface_version": PLANNING_INTERFACE,
            "scope": scope,
            "state": envelope("unavailable", reason="Project registry is unavailable"),
        }
    if scope["kind"] == "global":
        projects = [_planning_project(routing, item) for item in routing.projects]
        spaces = []
        for project in () if directory_only else routing.projects:
            binding = project["planning_binding"]
            if binding is not None:
                space_ref = planning_space_ref(binding)
                binding_state, _reason = routing.resolve(project["project_id"], binding)
                if binding_state == "mapped":
                    spaces.append(_space_view(routing, space_ref))
        state = (
            envelope("ready", payload={"projects": projects, "planning_spaces": spaces})
            if projects
            else envelope("empty", reason="platform.planning.noSpaces")
        )
        return {"interface_version": PLANNING_INTERFACE, "scope": scope, "state": state}
    project_id = scope["project_ref"]["project_id"]
    project = routing.project(project_id)
    space_ref = space_ref_parameters(parameters)
    routing.require_mapping(project_id, space_ref)
    space = _space_view(routing, space_ref)
    state = (
        envelope(
            "ready",
            payload={
                "projects": [_planning_project(routing, project)],
                "planning_spaces": [space],
            },
        )
        if space["work_items"]
        else envelope("empty", reason="platform.planning.empty")
    )
    return {"interface_version": PLANNING_INTERFACE, "scope": scope, "state": state}


def _planning_project(routing: PlanningRouting, project: dict) -> dict:
    directory = routing.directory_item(project)
    spaces = []
    for item in directory["resources"]:
        if item["state"] != "mapped":
            continue
        space_ref = planning_space_ref(item["resource_ref"])
        with routing.store_connection(space_ref) as store:
            row = store.execute(
                "SELECT p.name, COUNT(w.work_item_id) AS held FROM planning_spaces p"
                " LEFT JOIN work_items w ON w.planning_space_id = p.planning_space_id"
                " WHERE p.key = ? GROUP BY p.planning_space_id",
                (space_ref["space_key"],),
            ).fetchone()
        spaces.append(
            {
                "space_ref": space_ref,
                # The display name is the space's own, kept apart from its
                # identity: renaming it must not move a single binding.
                "title": str(row["name"]) if row else space_ref["space_key"],
                "work_item_count": int(row["held"]) if row else 0,
            }
        )
    return {
        "project_id": project["project_id"],
        "title": project["display_name"],
        "binding_state": directory["binding_state"],
        "planning_spaces": spaces,
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
            raise PlatformHttpError(
                409, "unavailable", "Exact Project planning space is unavailable"
            )
        work_items = [
            {
                "work_item_ref": {
                    "space_ref": space_ref,
                    "reference": f"{space_ref['space_key']}-{int(row['number'])}",
                },
                "title": row["title"],
                "state_key": row["state_key"],
                "state_category": row["category"],
                "priority": row["priority"],
                "labels": json.loads(row["labels"]),
                "claim_ref": row["claim_ref"],
                "revision": int(row["revision"]),
                "updated_at": row["updated_at"],
            }
            for row in store.execute(
                "SELECT w.number, w.title, w.priority, w.labels, w.claim_ref, w.revision,"
                " w.updated_at, s.key AS state_key, s.category"
                " FROM work_items w JOIN workflow_states s ON s.state_id = w.state_id"
                " WHERE w.planning_space_id = ? ORDER BY s.position, w.position, w.number",
                (str(space["planning_space_id"]),),
            )
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
    """One work item, read through the exact binding and store.

    The record comes from Planning's own service through the loader; this
    function owns the scope and the binding. `relations` is the registry's
    read model and is answered empty: the inspector reads links and refs from
    the work item itself.
    """

    scope = scope_parameters(parameters, project_extras=("data_scope_id", "space_key", "reference"))
    if scope["kind"] != "project":
        raise PlatformHttpError(400, "error", "Work item reads require exact Project scope")
    project_id = scope["project_ref"]["project_id"]
    routing.project(project_id)
    space_ref = space_ref_parameters(parameters)
    routing.require_mapping(project_id, space_ref)
    work_item_ref = validate_work_item_ref(
        {"space_ref": space_ref, "reference": one(parameters, "reference")}
    )
    with routing.store_connection(space_ref) as store:
        try:
            work_item = item_loader(store, work_item_ref["reference"])
        except (ValueError, KeyError) as error:
            raise PlatformHttpError(404, "unavailable", "Exact work item is unavailable") from error
    return {
        "interface_version": PLANNING_WORK_ITEM_INTERFACE,
        "scope": scope,
        "work_item_ref": work_item_ref,
        "state": envelope(
            "ready",
            payload={
                "work_item": work_item,
                "relations": {"interface_version": RELATIONS_INTERFACE, "relations": []},
            },
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
    module_gate.require_module_enabled(conn, "planning")
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
