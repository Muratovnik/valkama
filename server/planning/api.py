"""The neutral Planning boundary: one path set, spelled in WorkItems.

Transport-free on purpose. Every function here takes a connection, a path and a
payload and returns `(status, body)`, so the HTTP surface above it adds framing
and the MCP surface adds tool names without either of them owning a rule. The
Board era spread the same decisions across both and they drifted.

Nothing here gates on the cutover any more, and that is deliberate. While two
domains could share a store, every route refused with a typed unavailable naming
the migration; `store.connect()` now refuses to open a Board-era store at all,
so a connection that reaches this boundary is already past the conversion. One
refusal, in the one place that can act on it.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable, Mapping

from .. import query_params
from . import migration, model, service, transitions, views

PLANNING_API_INTERFACE = f"{model.PLANNING_INTERFACE}-api"


class PlanningHttpError(Exception):
    """A refusal with the status the surface should report."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def _first(parameters: Mapping[str, list[str]], name: str) -> str | None:
    return query_params.first(parameters, name, error=PlanningHttpError)


def _required(parameters: Mapping[str, list[str]], name: str) -> str:
    return query_params.required(parameters, name, error=PlanningHttpError)


def _int(value: object, name: str, default: int) -> int:
    if value is None:
        return default
    try:
        return int(str(value), 10)
    except ValueError as error:
        raise PlanningHttpError(400, "invalid_request", f"{name} must be an integer") from error


def _field(payload: Mapping[str, object], name: str) -> object:
    if name not in payload:
        raise PlanningHttpError(400, "invalid_request", f"{name} is required")
    return payload[name]


def _text(payload: Mapping[str, object], name: str) -> str:
    value = _field(payload, name)
    if not isinstance(value, str):
        raise PlanningHttpError(400, "invalid_request", f"{name} must be a string")
    return value


def _optional_text(payload: Mapping[str, object], name: str) -> str | None:
    """A field the caller may leave out, refused as text when it is present."""

    if name not in payload or payload[name] is None:
        return None
    value = payload[name]
    if not isinstance(value, str):
        raise PlanningHttpError(400, "invalid_request", f"{name} must be a string")
    return value


def _optional_int(payload: Mapping[str, object], name: str) -> int | None:
    value = payload.get(name)
    if value is None:
        return None
    if not isinstance(value, int) or isinstance(value, bool):
        raise PlanningHttpError(400, "invalid_request", f"{name} must be an integer")
    return value


def _flag(payload: Mapping[str, object], name: str) -> bool:
    value = payload.get(name, False)
    if not isinstance(value, bool):
        raise PlanningHttpError(400, "invalid_request", f"{name} must be a boolean")
    return value


def error_response(error: BaseException) -> tuple[int, dict]:
    """One mapping from a refusal to a status, for both surfaces."""

    if isinstance(error, PlanningHttpError):
        return error.status, {"error": {"code": error.code, "message": error.message}}
    if isinstance(error, model.RevisionConflictError):
        return 409, {
            "error": {
                "code": "revision_conflict",
                "message": str(error),
                "expected": error.expected,
                "actual": error.actual,
            }
        }
    if isinstance(error, model.WorkflowGuardError):
        return 409, {"error": {"code": "workflow_guard", "message": str(error)}}
    if isinstance(error, migration.MigrationRefused):
        return 409, {"error": {"code": "migration_refused", "message": str(error)}}
    if isinstance(error, model.PlanningError):
        return 400, {"error": {"code": "invalid_request", "message": str(error)}}
    raise error


# -- reads -------------------------------------------------------------------


def handle_get(
    conn: sqlite3.Connection, path: str, parameters: Mapping[str, list[str]]
) -> tuple[int, dict] | None:
    """Answer one neutral read, or return None when the path is not ours."""

    reader = _READS.get(path)
    if reader is None:
        return None
    return 200, reader(conn, parameters)


def _spaces(conn: sqlite3.Connection, _parameters: Mapping[str, list[str]]) -> dict:
    return {
        "interface_version": PLANNING_API_INTERFACE,
        "planning_spaces": service.list_planning_spaces(conn),
    }


def _chosen_space(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> str | None:
    """Which space the caller means: named outright, or the one its project binds.

    A browser knows which project it is in long before it knows a space id, and
    a Kernel binding still names the space the way the Board era did. Resolving
    the project here keeps that translation in one place instead of making every
    view carry it.
    """

    space = _first(parameters, "space")
    project = _first(parameters, "project")
    if space is not None and project is not None:
        raise PlanningHttpError(
            400, "invalid_request", "space and project are two answers to one question"
        )
    if space is not None:
        return space
    if project is None:
        return None
    bound = views.space_for_project(conn, project)
    if bound is None:
        raise PlanningHttpError(404, "unavailable", f"project {project} has no planning space yet")
    return str(bound["planning_space_id"])


def _read_model(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    return views.planning_payload(
        conn,
        space=_chosen_space(conn, parameters),
        limit=_int(_first(parameters, "limit"), "limit", 1000),
    )


def _graph(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    return views.graph_payload(conn, space=_chosen_space(conn, parameters))


def _activity(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    return {
        "interface_version": PLANNING_API_INTERFACE,
        "activity": views.activity_feed(conn, _int(_first(parameters, "limit"), "limit", 100)),
    }


def _work_items(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    return {
        "interface_version": PLANNING_API_INTERFACE,
        "work_items": service.list_work_items(
            conn,
            space=_first(parameters, "space"),
            state_key=_first(parameters, "state"),
            category=_first(parameters, "category"),
            kind=_first(parameters, "kind"),
            owner=_first(parameters, "owner"),
            limit=_int(_first(parameters, "limit"), "limit", 200),
        ),
    }


def _work_item(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    return {
        "interface_version": PLANNING_API_INTERFACE,
        "work_item": service.get_work_item(conn, _required(parameters, "id")),
    }


def _search(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    return {
        "interface_version": PLANNING_API_INTERFACE,
        "work_items": service.search_work_items(
            conn,
            _required(parameters, "q"),
            space=_first(parameters, "space"),
            limit=_int(_first(parameters, "limit"), "limit", 50),
        ),
    }


_READS: dict[str, Callable[[sqlite3.Connection, Mapping[str, list[str]]], dict]] = {
    "/api/planning": _read_model,
    "/api/planning/spaces": _spaces,
    "/api/planning/graph": _graph,
    "/api/planning/activity": _activity,
    "/api/planning/work-items": _work_items,
    # The id travels as a parameter rather than a path segment, which is what
    # every other exact read on this surface already does; the module gate keys
    # on exact paths and a segment would need a second matching rule.
    "/api/planning/work-item": _work_item,
    "/api/planning/search": _search,
}


# -- writes ------------------------------------------------------------------


def handle_post(
    conn: sqlite3.Connection, path: str, payload: Mapping[str, object]
) -> tuple[int, dict] | None:
    writer = _WRITES.get(path)
    if writer is None:
        return None
    if not isinstance(payload, Mapping):
        raise PlanningHttpError(400, "invalid_request", "request body must be a JSON object")
    return 200, writer(conn, payload)


def _create(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    return service.create_work_item(
        conn,
        space=_text(payload, "space"),
        title=_text(payload, "title"),
        state=_optional_text(payload, "state"),
        kind=str(payload.get("kind") or "task"),
        priority=str(payload.get("priority") or "medium"),
        description=str(payload.get("description") or ""),
        labels=payload.get("labels"),
        source=str(payload.get("source") or ""),
        parent=_optional_text(payload, "parent"),
        author=_author(payload),
    )


def _update(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    return service.update_work_item(
        conn,
        _text(payload, "id"),
        title=_optional_text(payload, "title"),
        description=(_optional_text(payload, "description")),
        source=_optional_text(payload, "source"),
        priority=(_optional_text(payload, "priority")),
        labels=payload.get("labels"),
        kind=_optional_text(payload, "kind"),
        parent=_optional_text(payload, "parent"),
        expected_revision=_optional_int(payload, "expected_revision"),
        author=_author(payload),
    )


def _delete(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    return service.delete_work_item(conn, _text(payload, "id"))


def _transition(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    record = service.transition_work_item(
        conn,
        _text(payload, "id"),
        _text(payload, "state"),
        reason=str(payload.get("reason") or ""),
        force=_flag(payload, "force"),
        expected_revision=_optional_int(payload, "expected_revision"),
        author=_author(payload),
        improvement_guard=_IMPROVEMENT_GUARD,
    )
    if _TRANSITION_OBSERVER is not None and str(record.get("source") or ""):
        # Advisory: a linked case that cannot follow says so, and the transition
        # that already happened is not undone by it.
        _TRANSITION_OBSERVER(str(record["source"]), str(record["state"]["category"]))
    return record


#: The guard an Improvements case puts on closing its own work item, injected by
#: whichever surface is running. Planning does not import Improvements: they are
#: independent modules, and a module that had to know about another to close an
#: item would make that item's rules depend on what else happens to be
#: installed.
_IMPROVEMENT_GUARD: transitions.ImprovementGuard | None = None


#: What else wants to know that an item moved, by source marker and by the
#: category it moved into. Advisory by construction: the transition is already
#: committed, so a refusal here is reported and never rolled back.
TransitionObserver = Callable[[str, str], str | None]
_TRANSITION_OBSERVER: TransitionObserver | None = None


def use_improvement_guard(guard: transitions.ImprovementGuard | None) -> None:
    """Install the process-wide guard. Called once, by a surface, at startup."""

    global _IMPROVEMENT_GUARD
    _IMPROVEMENT_GUARD = guard


def use_transition_observer(observer: TransitionObserver | None) -> None:
    """Install the process-wide post-transition observer."""

    global _TRANSITION_OBSERVER
    _TRANSITION_OBSERVER = observer


def _claim(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    return service.claim_work_item(
        conn,
        _text(payload, "id"),
        author=_author(payload),
        force=_flag(payload, "force"),
        release=_flag(payload, "release"),
        expected_revision=_optional_int(payload, "expected_revision"),
    )


def _claim_ready(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    picked = service.claim_ready_work_item(
        conn,
        space=_optional_text(payload, "space"),
        author=_author(payload),
    )
    return {"interface_version": PLANNING_API_INTERFACE, "work_item": picked}


def _checklist(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    return service.set_checklist(
        conn,
        _text(payload, "id"),
        _field(payload, "items"),
        force=_flag(payload, "force"),
        expected_revision=_optional_int(payload, "expected_revision"),
        author=_author(payload),
    )


def _checklist_claim(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    return service.claim_checklist_item(
        conn,
        _text(payload, "id"),
        _text(payload, "item_id"),
        author=_author(payload),
        force=_flag(payload, "force"),
        release=_flag(payload, "release"),
        expected_revision=_optional_int(payload, "expected_revision"),
    )


def _checklist_tick(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    done = payload.get("done", True)
    if not isinstance(done, bool):
        raise PlanningHttpError(400, "invalid_request", "done must be a boolean")
    return service.tick_checklist_item(
        conn,
        _text(payload, "id"),
        _text(payload, "item_id"),
        done=done,
        author=_author(payload),
        force=_flag(payload, "force"),
        expected_revision=_optional_int(payload, "expected_revision"),
    )


def _link(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    return service.link_work_items(
        conn,
        _text(payload, "id"),
        _text(payload, "other"),
        _text(payload, "kind"),
        remove=_flag(payload, "remove"),
        author=_author(payload),
    )


def _summary(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    return service.set_summary(
        conn,
        _text(payload, "id"),
        _field(payload, "summary"),
        expected_revision=_optional_int(payload, "expected_revision"),
        author=_author(payload),
    )


def _comment(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    return service.comment_work_item(
        conn, _text(payload, "id"), _text(payload, "body"), author=_author(payload)
    )


def _ref(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    return service.attach_ref(
        conn,
        _text(payload, "id"),
        _text(payload, "kind"),
        _text(payload, "value"),
        label=str(payload.get("label") or ""),
        author=_author(payload),
    )


def _space(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    return service.create_planning_space(
        conn,
        project_id=_text(payload, "project_id"),
        name=_text(payload, "name"),
        key=_optional_text(payload, "key"),
    )


def _author(payload: Mapping[str, object]) -> str | None:
    value = payload.get("author")
    if value is None:
        return None
    if not isinstance(value, str):
        raise PlanningHttpError(400, "invalid_request", "author must be a string")
    return value


_WRITES: dict[str, Callable[[sqlite3.Connection, Mapping[str, object]], dict]] = {
    "/api/planning/spaces": _space,
    "/api/planning/work-items": _create,
    "/api/planning/work-item/update": _update,
    "/api/planning/work-item/delete": _delete,
    "/api/planning/work-item/transition": _transition,
    "/api/planning/work-item/claim": _claim,
    "/api/planning/work-item/claim-ready": _claim_ready,
    "/api/planning/work-item/checklist": _checklist,
    "/api/planning/work-item/checklist/claim": _checklist_claim,
    "/api/planning/work-item/checklist/tick": _checklist_tick,
    "/api/planning/work-item/link": _link,
    "/api/planning/work-item/summary": _summary,
    "/api/planning/work-item/comment": _comment,
    "/api/planning/work-item/ref": _ref,
}

READ_PATHS = tuple(sorted(_READS))
WRITE_PATHS = tuple(sorted(_WRITES))
