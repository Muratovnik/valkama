"""Mapped Planning search and human-request transport contracts.

Each operation reaches a store only through `PlanningRouting`, so a search or a
request names an exact project binding and never a key-only space.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Mapping

from ..platform import module_gate
from ..store_identity.primitives import ContractError
from ..store_identity.refs import planning_space_ref, validate_planning_space_ref
from . import api, model, read_model, requests, service
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
        "/api/modules/planning/request/decline",
        "/api/modules/planning/request/expire",
    }
)


def _limit(parameters: Mapping[str, list[str]], default: int) -> int:
    raw = parameters.get("limit", [str(default)])
    if len(raw) != 1 or not raw[0].isdigit() or not 1 <= int(raw[0]) <= 100:
        raise api.PlanningHttpError(400, "invalid_request", "limit must be between 1 and 100")
    return int(raw[0])


def _target(routing: PlanningRouting, project_id: str, space_ref: dict, reference: str) -> dict:
    return {
        "project_id": project_id,
        "space_ref": space_ref,
        "reference": reference,
        "writable": space_ref["data_scope_id"] == routing.metadata["data_scope_id"],
    }


def _resources(routing: PlanningRouting) -> list[tuple[str, dict]]:
    if routing.projects_result["status"] != "available":
        raise api.PlanningHttpError(409, "unavailable", "project_registry_unavailable")
    result = []
    for project in routing.projects:
        binding = project.get("planning_binding")
        if binding is None:
            continue
        try:
            result.append((project["project_id"], planning_space_ref(binding)))
        except (ContractError, KeyError, TypeError) as error:
            raise api.PlanningHttpError(409, "unavailable", "planning_binding_invalid") from error
    return sorted(
        result, key=lambda pair: (pair[0], pair[1]["data_scope_id"], pair[1]["space_key"])
    )


def search(routing: PlanningRouting, parameters: Mapping[str, list[str]]) -> dict:
    if set(parameters) - {"q", "limit"} or "q" not in parameters:
        raise api.PlanningHttpError(400, "invalid_request", "search requires q and optional limit")
    query = model.text_field(_one(parameters, "q"), "query", limit=200)
    limit = _limit(parameters, 50)
    items: list[dict] = []
    coverage: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    more = False
    for project_id, space_ref in _resources(routing):
        entry: dict = {
            "project_id": project_id,
            "space_ref": space_ref,
            "status": "unavailable",
            "reason": "source_unavailable",
        }
        try:
            module_gate.require_module_enabled(routing.conn, "planning")
            with routing.planning_store(_store_parameters(project_id, space_ref)) as (conn, _key):
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
                            "target": _target(routing, project_id, space_ref, item["reference"]),
                            "item": {
                                "work_item_id": item["work_item_id"],
                                "planning_space_id": item["planning_space_id"],
                                "reference": item["reference"],
                                "title": item["title"],
                                "state": {"name": item["state"]["name"]},
                                "claim_ref": item["claim_ref"],
                            },
                        }
                    )
            entry.update(status="searched", reason=None)
        except (api.PlanningHttpError, ValueError, sqlite3.Error, KeyError, TypeError):
            pass
        coverage.append(entry)
    return {
        "interface_version": "valkama-planning-search",
        "query": query,
        "limit": limit,
        "has_more": more or len(items) > limit,
        "items": items[:limit],
        "coverage": coverage,
    }


def _exact_parameters(parameters: Mapping[str, list[str]], extras: set[str]) -> tuple[str, dict]:
    required = {"scope_kind", "project_id", "data_scope_id", "space_key", *extras}
    if set(parameters) != required or _one(parameters, "scope_kind") != "project":
        raise api.PlanningHttpError(400, "invalid_request", "exact_project_fields_required")
    project_id = _one(parameters, "project_id")
    space_ref = validate_planning_space_ref(
        {
            "data_scope_id": _one(parameters, "data_scope_id"),
            "space_key": _one(parameters, "space_key"),
        }
    )
    return project_id, space_ref


def _request_item(conn: sqlite3.Connection, record: dict, key: str) -> None:
    item = read_model.item_by_id(conn, record["work_item_id"])
    space = service.get_planning_space(conn, key)
    if item["planning_space_id"] != space["planning_space_id"]:
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
    module_gate.require_module_enabled(routing.conn, "planning")
    project_id, space_ref = _exact_parameters(parameters, {"id"})
    with routing.planning_store(_store_parameters(project_id, space_ref)) as (conn, _key):
        _capability(conn)
        record = requests.get(conn, _one(parameters, "id"))
        _request_item(conn, record, space_ref["space_key"])
    return {
        "interface_version": "valkama-planning-requests",
        "target": _target(routing, project_id, space_ref, record["reference"]),
        "request": record,
    }


def request_list(routing: PlanningRouting, parameters: Mapping[str, list[str]]) -> dict:
    limit = _limit(parameters, 100)
    status = _one(parameters, "status") if "status" in parameters else None
    if status is not None:
        model.enum_field(
            status, frozenset({"pending", "answered", "declined", "expired"}), "status"
        )
    scoped = {key: value for key, value in parameters.items() if key not in {"limit", "status"}}
    scope_kind = _one(scoped, "scope_kind")
    reference = None
    if scope_kind == "global":
        if set(scoped) != {"scope_kind"}:
            raise api.PlanningHttpError(400, "invalid_request", "global_scope_fields_invalid")
        resources = _resources(routing)
    else:
        reference = _one(scoped, "reference") if "reference" in scoped else None
        project_id, space_ref = _exact_parameters(
            scoped, {"reference"} if reference is not None else set()
        )
        resources = [(project_id, space_ref)]
    items: list[dict] = []
    coverage: list[dict] = []
    seen: set[tuple[str, str]] = set()
    more = False
    for project_id, space_ref in resources:
        entry: dict = {
            "project_id": project_id,
            "space_ref": space_ref,
            "status": "unavailable",
            "reason": "requests_unavailable",
        }
        try:
            module_gate.require_module_enabled(routing.conn, "planning")
            with routing.planning_store(_store_parameters(project_id, space_ref)) as (conn, _key):
                _capability(conn)
                found = requests.list_requests(
                    conn,
                    space=space_ref["space_key"],
                    status=status,
                    limit=limit + 1,
                    reference=reference,
                )
                more = more or len(found) > limit
                for record in found:
                    identity = (space_ref["data_scope_id"], record["request_id"])
                    if identity not in seen:
                        seen.add(identity)
                        items.append(
                            {
                                "target": _target(
                                    routing, project_id, space_ref, record["reference"]
                                ),
                                "request": record,
                            }
                        )
            entry.update(status="searched", reason=None)
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
        "items": items[:limit],
        "coverage": coverage,
        "limit": limit,
        "has_more": more or len(items) > limit,
    }


def request_command(routing: PlanningRouting, path: str, payload: dict) -> dict:
    module_gate.require_module_enabled(routing.conn, "planning")
    scope_fields = {"project_id", "data_scope_id", "space_key"}
    base = path == "/api/modules/planning/request"
    operation_fields = (
        {"id", "kind", "prompt", "fields", "author", "execution_id", "session_id", "expires_at"}
        if base
        else {"id", "expected_revision", "author"}
    )
    if path.endswith("/answer"):
        operation_fields.add("answers")
    required = scope_fields | (
        {"id", "kind", "prompt", "fields"} if base else {"id", "expected_revision"}
    )
    if path.endswith("/answer"):
        required.add("answers")
    if set(payload) - (scope_fields | operation_fields) or not required <= set(payload):
        raise api.PlanningHttpError(
            400, "invalid_request", "request body has missing or unknown fields"
        )
    parameters = {key: [payload[key]] for key in scope_fields}
    parameters["scope_kind"] = ["project"]
    with routing.conn:
        if not routing.conn.in_transaction:
            routing.conn.execute("BEGIN IMMEDIATE")
        project_id, space_ref = _exact_parameters(parameters, set())
        if space_ref["data_scope_id"] != routing.metadata["data_scope_id"]:
            raise api.PlanningHttpError(409, "unavailable", "attached_store_readonly")
        with routing.planning_store(_store_parameters(project_id, space_ref)) as (conn, _key):
            _capability(conn)
            operation = {key: value for key, value in payload.items() if key not in scope_fields}
            if base:
                item = service.get_work_item(
                    conn, model.text_field(operation.get("id"), "id", limit=128)
                )
                if (
                    item["planning_space_id"]
                    != service.get_planning_space(conn, space_ref["space_key"])["planning_space_id"]
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
        "target": _target(routing, project_id, space_ref, record["reference"]),
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


def _store_parameters(project_id: str, space_ref: dict) -> dict[str, list[str]]:
    return {
        "project": [project_id],
        "data_scope_id": [space_ref["data_scope_id"]],
        "space_key": [space_ref["space_key"]],
    }
