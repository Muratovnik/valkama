"""The memory boundary: search a project's knowledge, and read one document.

Transport-free, like Planning's and the execution module's. Four reads and no
writes, because the provider behind them has no write capability — and a
boundary that offered one anyway would be the interface pretending a read-only
source is something else, which is exactly what §16.7 says this module must not
do.

Only one of the four asks a provider anything. `linked` reads Valkama's own
attached pointers and `providers` reads the registry, so both still answer when
every knowledge root on the machine is gone — which is the state a reader most
needs a page for.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable, Mapping

from .. import query_params
from . import contracts, service

MEMORY_API_INTERFACE = "valkama-memory-api"


class MemoryHttpError(Exception):
    """A refusal with the status the surface should report."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def error_response(error: BaseException) -> tuple[int, dict]:
    if isinstance(error, MemoryHttpError):
        return error.status, {"error": {"code": error.code, "message": error.message}}
    if isinstance(error, contracts.KnowledgeError):
        return 404, {"error": {"code": "unavailable", "message": str(error)}}
    raise error


def handle_get(
    conn: sqlite3.Connection, path: str, parameters: Mapping[str, list[str]]
) -> tuple[int, dict] | None:
    reader = _READS.get(path)
    if reader is not None:
        # Knowledge lives outside the store, by design.
        return 200, reader(parameters)
    stored = _STORE_READS.get(path)
    if stored is None:
        return None
    return 200, stored(conn, parameters)


def _search(parameters: Mapping[str, list[str]]) -> dict:
    project = _required(parameters, "project")
    query = _required(parameters, "q")
    return {
        "interface_version": MEMORY_API_INTERFACE,
        "project_id": project,
        **service.search(project, query, limit=_int(_first(parameters, "limit"), 20)),
    }


def _document(parameters: Mapping[str, list[str]]) -> dict:
    project = _required(parameters, "project")
    return {
        "interface_version": MEMORY_API_INTERFACE,
        "project_id": project,
        **service.document(project, _required(parameters, "id")),
    }


def _providers(parameters: Mapping[str, list[str]]) -> dict:
    if parameters:
        raise MemoryHttpError(400, "invalid_request", "this read takes no parameters")
    return {"interface_version": MEMORY_API_INTERFACE, **service.providers()}


def _linked(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    project = _required(parameters, "project")
    return {
        "interface_version": MEMORY_API_INTERFACE,
        "project_id": project,
        **service.linked(conn, project),
    }


def _first(parameters: Mapping[str, list[str]], name: str) -> str | None:
    return query_params.first(parameters, name, error=MemoryHttpError)


def _required(parameters: Mapping[str, list[str]], name: str) -> str:
    return query_params.required(parameters, name, error=MemoryHttpError)


def _int(value: object, default: int) -> int:
    if value is None:
        return default
    try:
        return int(str(value), 10)
    except ValueError as error:
        raise MemoryHttpError(400, "invalid_request", "limit must be an integer") from error


_READS: dict[str, Callable[[Mapping[str, list[str]]], dict]] = {
    "/api/memory/search": _search,
    "/api/memory/document": _document,
    "/api/memory/providers": _providers,
}

#: The read that needs the store rather than a provider, kept apart so the
#: transport cannot hand a connection to a reader that has no business with one.
_STORE_READS: dict[str, Callable[[sqlite3.Connection, Mapping[str, list[str]]], dict]] = {
    "/api/memory/linked": _linked,
}

READ_PATHS = tuple(sorted(_READS | _STORE_READS))

__all__ = ["MEMORY_API_INTERFACE", "READ_PATHS", "MemoryHttpError", "error_response", "handle_get"]
