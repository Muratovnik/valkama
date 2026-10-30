"""What the web app shell reads before any module renders, and what it remembers.

Three answers, all the shell's own: the modules this build ships
(`/api/modules`, read from `platform.modules` rather than the store), the context -- the primary store's identity and the project
directory with each project's binding state (`/api/platform/context`) -- and
the last route the shell restores on its next start (`/api/platform/ui-prefs`).

Reads here write nothing. Saving the last route is the only write, and it
touches nothing but its own row.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Mapping
from datetime import UTC, datetime

from .planning.routing import PlanningRouting, scope_parameters
from .platform import modules as platform_modules
from .projects import project_registry
from .store_identity.primitives import ContractError
from .store_identity.refs import validate_entity_ref, validate_operating_scope
from .ui_state import PlatformHttpError, envelope

CONTEXT_INTERFACE = "valkama-context"
UI_PREFS_INTERFACE = "valkama-ui-prefs"

MODULES_PATH = "/api/modules"
CONTEXT_PATH = "/api/platform/context"
UI_PREFS_PATH = "/api/platform/ui-prefs"
READ_PATHS = frozenset({MODULES_PATH, CONTEXT_PATH})
WRITE_PATHS = frozenset({UI_PREFS_PATH})


def _exact_object(value, allowed, *, required) -> None:
    if not isinstance(value, dict) or set(value) - set(allowed) or not set(required) <= set(value):
        raise ContractError("request body has missing or unknown fields")


def _validated_ui_prefs(value) -> dict:
    _exact_object(value, ("module_id", "scope", "resource_ref"), required=("module_id", "scope"))
    module_id = value["module_id"]
    if not isinstance(module_id, str) or module_id not in platform_modules.module_ids():
        raise PlatformHttpError(400, "error", "UI preference names an unknown module")
    prefs = {"module_id": module_id, "scope": validate_operating_scope(value["scope"])}
    if "resource_ref" in value:
        prefs["resource_ref"] = validate_entity_ref(value["resource_ref"])
    return prefs


def ui_prefs_record(conn: sqlite3.Connection) -> dict | None:
    """Last-route preference, or None when unset or unreadable."""

    row = conn.execute(
        "SELECT record_json FROM platform_ui_prefs WHERE key='last-route'"
    ).fetchone()
    if row is None:
        return None
    try:
        return _validated_ui_prefs(json.loads(str(row[0])))
    except Exception:  # noqa: BLE001 -- a corrupt row must never break the shell context
        return None


def save_ui_prefs(conn: sqlite3.Connection, payload) -> dict:
    _exact_object(
        payload,
        ("interface_version", "module_id", "scope", "resource_ref"),
        required=("interface_version", "module_id", "scope"),
    )
    if payload["interface_version"] != UI_PREFS_INTERFACE:
        raise PlatformHttpError(400, "error", "UI preference payload version is not supported")
    prefs = _validated_ui_prefs(
        {key: value for key, value in payload.items() if key != "interface_version"}
    )
    conn.execute(
        "INSERT INTO platform_ui_prefs(key,record_json,updated_at)"
        " VALUES('last-route',?,?)"
        " ON CONFLICT(key) DO UPDATE SET"
        " record_json=excluded.record_json, updated_at=excluded.updated_at",
        (
            json.dumps(prefs, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
            datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        ),
    )
    conn.commit()
    return {"interface_version": UI_PREFS_INTERFACE, "prefs": prefs}


def context_payload(routing: PlanningRouting, parameters: Mapping[str, list[str]]) -> dict:
    scope = scope_parameters(parameters)
    payload = {
        "primary": {
            "data_scope_id": routing.metadata["data_scope_id"],
            "is_writable": True,
        },
        "projects": [routing.directory_item(item) for item in routing.projects],
        "ui_prefs": ui_prefs_record(routing.conn),
    }
    if routing.projects_result["status"] != "available":
        state = envelope("unavailable", reason="Project registry is unavailable")
    else:
        if scope["kind"] == "project":
            routing.project(scope["project_ref"]["project_id"])
        state = envelope("ready", payload=payload)
    return {"interface_version": CONTEXT_INTERFACE, "scope": scope, "state": state}


def handle_get(
    conn: sqlite3.Connection,
    primary_db: str,
    path: str,
    parameters: Mapping[str, list[str]],
    *,
    registry_reader: project_registry.RegistryReader | None = None,
) -> tuple[int, dict] | None:
    """Answer one shell read, or return None when the path is not ours."""

    if path == MODULES_PATH:
        if parameters:
            raise PlatformHttpError(400, "error", "Module registry accepts no query fields")
        return 200, platform_modules.modules_payload()
    if path == CONTEXT_PATH:
        routing = PlanningRouting(conn, primary_db, registry_reader=registry_reader)
        return 200, context_payload(routing, parameters)
    return None


def handle_post(conn: sqlite3.Connection, path: str, payload: dict) -> tuple[int, dict] | None:
    """Answer the shell's one write, or return None when the path is not ours."""

    if path != UI_PREFS_PATH:
        return None
    return 200, save_ui_prefs(conn, payload)
