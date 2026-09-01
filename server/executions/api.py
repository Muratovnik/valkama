"""The execution boundary: what can be launched, what has run, and attaching a session.

Transport-free, like Planning's. Every function takes a connection, a path and a
payload and returns `(status, body)`; the HTTP surface adds framing.

The launch and stop routes are not here. They predate this boundary, they are
already dispatched by the surface, and moving them would change two things at
once — the shape of the surface and the shape of the launch path — in a commit
whose subject is neither.

What is here is the half layer 2 was missing: the client's own answer to "what
can I choose", the attempt history an inspector shows, and the one deliberate
way an interactive session becomes part of a work item's record.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable, Mapping

from .. import query_params, runner
from ..planning import api as planning_api
from ..planning import service as planning_service
from ..platform.contracts import planning_space_entity
from ..platform.scope import read_store_metadata
from ..projects import project_registry
from ..telemetry import projections as telemetry
from . import drivers, results
from . import service as execution_service

EXECUTION_API_INTERFACE = "valkama-execution-api"


class ExecutionHttpError(Exception):
    """A refusal with the status the surface should report."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def error_response(error: BaseException) -> tuple[int, dict]:
    """One mapping from a refusal to a status, for the surface above.

    Planning's refusals pass through unchanged: attaching names a work item, and
    a bad reference is Planning's answer to give, not this module's to reword.
    """

    if isinstance(error, ExecutionHttpError):
        return error.status, {"error": {"code": error.code, "message": error.message}}
    if isinstance(error, runner.LaunchError):
        return 422, {"error": {"code": "launch_refused", "message": str(error)}}
    return planning_api.error_response(error)


def handle_get(
    conn: sqlite3.Connection, path: str, parameters: Mapping[str, list[str]]
) -> tuple[int, dict] | None:
    """Answer one execution read, or return None when the path is not ours."""

    reader = _READS.get(path)
    if reader is None:
        return None
    return 200, reader(conn, parameters)


def handle_post(
    conn: sqlite3.Connection, path: str, payload: Mapping[str, object]
) -> tuple[int, dict] | None:
    writer = _WRITES.get(path)
    if writer is None:
        return None
    return 200, writer(conn, payload)


def _capabilities(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    """What a launch may be asked for, answered by the drivers rather than assumed.

    Health is included because a client that is not on this machine is a
    different answer from a client that cannot take an option: the first is a
    chooser that should say why it is empty, the second is one that should hide
    a field. Both used to look the same to an interface, which offered every
    client every option and let the client refuse afterwards.
    """

    catalogue = []
    for capability in drivers.all_capabilities():
        record = capability.as_dict()
        try:
            runner.client_binary(capability.client)
            record["health"] = "ready"
            record["unavailable_reason"] = ""
        except runner.LaunchError as error:
            record["health"] = "unavailable"
            record["unavailable_reason"] = str(error)
        catalogue.append(record)
    return {
        "interface_version": EXECUTION_API_INTERFACE,
        "drivers": catalogue,
        # The rest of the packet is Valkama's own vocabulary, not a client's,
        # and an interface that hard-codes it drifts from the validator that
        # refuses it. Half of it is the launch's own — what may be asked for —
        # and half is the result contract, which is `results`' to state.
        "roles": list(runner.ROLES),
        "environments": list(runner.ENVIRONMENTS),
        "expected_effects": list(results.EXPECTED_EFFECTS),
        "review_modes": list(results.REVIEW_MODES),
        "review_verdicts": {mode: list(values) for mode, values in results.REVIEW_VERDICTS.items()},
        "max_prompt_chars": runner.MAX_PROMPT_CHARS,
        **_suggested_repository(conn, _first(parameters, "work_item")),
    }


def _suggested_repository(conn: sqlite3.Connection, reference: str | None) -> dict:
    """The directory this item's space is mapped to, or an honest nothing.

    Resolved through the project registry, which is where a mapping is written
    down, rather than from the platform's own working directory or from the
    last launch. Those two are the guesses that put an agent in the wrong
    checkout, and a form that prefills a wrong path is worse than one that
    prefills none: the operator reads the field as an answer.

    The status travels with it so an interface can say why the field is empty
    instead of looking like it forgot.
    """

    if not reference:
        return {"repository": "", "repository_status": "missing"}
    try:
        record = planning_service.get_work_item(conn, reference)
    except Exception:  # noqa: BLE001 -- a bad reference is not a reason to hide the clients
        return {"repository": "", "repository_status": "missing"}
    row = conn.execute(
        "SELECT key FROM planning_spaces WHERE planning_space_id = ?",
        (str(record["planning_space_id"]),),
    ).fetchone()
    if row is None:
        return {"repository": "", "repository_status": "missing"}
    resource_ref = planning_space_entity(
        {
            "data_scope_id": read_store_metadata(conn)["data_scope_id"],
            "space_key": str(row[0]),
        }
    )
    resolved = project_registry.resolve_space_root(resource_ref)
    return {
        "repository": str(resolved.get("canonical_root") or ""),
        "repository_status": str(resolved.get("status") or "missing"),
    }


def _history(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    """Every attempt at one work item, newest first."""

    reference = _required(parameters, "work_item")
    record = _work_item(conn, reference)
    return {
        "interface_version": EXECUTION_API_INTERFACE,
        "work_item": reference,
        "executions": execution_service.executions_for_work_item(
            conn, str(record["work_item_id"]), _int(_first(parameters, "limit"), "limit", 20)
        ),
    }


def _usage(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    """What one attempt cost, from whatever local source observed it.

    Its own read rather than a field on the history, because it costs journal
    files on disk and the history is the list an inspector opens with. A reader
    who never opens the Usage section never pays for it.
    """

    execution_id = _required(parameters, "execution_id")
    try:
        return {
            "interface_version": EXECUTION_API_INTERFACE,
            "usage": telemetry.execution_usage(conn, execution_id),
        }
    except ValueError as error:
        raise ExecutionHttpError(404, "unavailable", str(error)) from error


def _attach(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    """Bind an observed session to a work item, because a person said so.

    This is the only way a session that Valkama did not launch becomes part of
    an item's record, and it is explicit for the reason §6.1 gives: every
    automatic route to the same result — nearest in time, same directory, newest
    journal — is a guess that is wrong exactly when it matters.

    The attempt it creates is `attached`, already ended, and carries no result:
    Valkama did not run it and has nothing to claim about what it delivered.
    """

    reference = _text(payload, "work_item")
    session_id = _text(payload, "session_id")
    record = _work_item(conn, reference)
    row = conn.execute("SELECT client FROM sessions WHERE id = ?", (session_id,)).fetchone()
    if row is None:
        raise ExecutionHttpError(404, "unavailable", f"no observed session {session_id!r}")
    author = str(payload.get("author") or "owner")

    execution_id = execution_service.new_execution_id()
    execution_service.open_execution(
        conn,
        execution_id=execution_id,
        work_item_id=str(record["work_item_id"]),
        project_id="",
        packet={
            "client": str(row["client"]),
            "role": "executor",
            "environment": "workdir",
            "expected_effect": "change_required",
        },
    )
    execution_service.link_session(conn, execution_id, session_id, "attached")
    execution_service.close_execution(
        conn,
        execution_id,
        status="attached",
        outcome="attached",
        result={
            "outcome": "attached",
            "delivery": "",
            "oracle": "attached by a person; Valkama did not run this session",
            "unresolved": "",
            "structured": False,
        },
    )
    conn.commit()
    planning_service.attach_ref(
        conn, reference, "session", session_id, label="attached session", author=author
    )
    planning_service.comment_work_item(
        conn, reference, f"attached the observed session {session_id}", author=author
    )
    conn.commit()
    return {
        "interface_version": EXECUTION_API_INTERFACE,
        "work_item": reference,
        "session_id": session_id,
        "execution_id": execution_id,
    }


def _work_item(conn: sqlite3.Connection, reference: str) -> dict:
    """The item this request names, refusing through Planning's own vocabulary."""

    return planning_service.get_work_item(conn, reference)


def _first(parameters: Mapping[str, list[str]], name: str) -> str | None:
    return query_params.first(parameters, name, error=ExecutionHttpError)


def _required(parameters: Mapping[str, list[str]], name: str) -> str:
    return query_params.required(parameters, name, error=ExecutionHttpError)


def _int(value: object, name: str, default: int) -> int:
    if value is None:
        return default
    try:
        return int(str(value), 10)
    except ValueError as error:
        raise ExecutionHttpError(400, "invalid_request", f"{name} must be an integer") from error


def _text(payload: Mapping[str, object], name: str) -> str:
    value = payload.get(name)
    if not isinstance(value, str) or not value.strip():
        raise ExecutionHttpError(400, "invalid_request", f"{name} is required")
    return value.strip()


_READS: dict[str, Callable[[sqlite3.Connection, Mapping[str, list[str]]], dict]] = {
    "/api/execution/capabilities": _capabilities,
    "/api/execution/history": _history,
    "/api/execution/usage": _usage,
}

_WRITES: dict[str, Callable[[sqlite3.Connection, Mapping[str, object]], dict]] = {
    "/api/execution/attach": _attach,
}

READ_PATHS = tuple(sorted(_READS))
WRITE_PATHS = tuple(sorted(_WRITES))

__all__ = [
    "EXECUTION_API_INTERFACE",
    "READ_PATHS",
    "WRITE_PATHS",
    "ExecutionHttpError",
    "error_response",
    "handle_get",
    "handle_post",
]
