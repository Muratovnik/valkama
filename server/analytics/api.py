"""The Analytics boundary: its reads, its one write and its refusals, with no transport.

Like Planning's and Memory's, every function takes a connection, a path and the parsed
query or body and returns `(status, body)`; the HTTP surface adds the framing. No MCP
tool reads or writes this: the numbers would cost an agent context, as the per-item
read's would, and a use is counted by the page a person opened.

A list travels as one parameter with its values separated by commas, because a repeated
parameter is refused everywhere (`query_params`).
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable, Mapping

from .. import query_params
from . import usage, uses

ANALYTICS_API_INTERFACE = "valkama-analytics-api"
USAGE_PATH = "/api/analytics/usage"
#: How often each analytics surface was opened: read by `GET`, counted by `POST`.
USES_PATH = "/api/analytics/uses"

_PARAMETERS = frozenset(
    {"from", "to", "step", "utc_offset", "group_by", "compare", "none", *usage.DIMENSIONS}
)


class AnalyticsHttpError(Exception):
    """A refusal with the status the surface should report."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def error_response(error: BaseException) -> tuple[int, dict]:
    """A refusal in the envelope the neighbouring reads answer with."""

    if isinstance(error, AnalyticsHttpError):
        return error.status, {"error": {"code": error.code, "message": error.message}}
    if isinstance(error, (usage.UsageQueryError, uses.UseError)):
        return 400, {"error": {"code": "invalid_request", "message": str(error)}}
    raise error


def _first(parameters: Mapping[str, list[str]], name: str) -> str | None:
    return query_params.first(parameters, name, error=AnalyticsHttpError)


def _list(parameters: Mapping[str, list[str]], name: str) -> list[str]:
    value = _first(parameters, name)
    return [] if value is None else value.split(",")


def _refuse_unknown(parameters: Mapping[str, list[str]], known: frozenset[str]) -> None:
    unknown = sorted(set(parameters) - known)
    if unknown:
        raise AnalyticsHttpError(400, "invalid_request", f"{unknown[0]} is not a parameter")


def _offset(parameters: Mapping[str, list[str]]) -> int:
    value = _first(parameters, "utc_offset")
    if value is None:
        return 0
    try:
        return int(value, 10)
    except ValueError as error:
        raise AnalyticsHttpError(
            400, "invalid_request", "utc_offset must be a whole number of minutes"
        ) from error


def _compare(parameters: Mapping[str, list[str]]) -> bool:
    value = _first(parameters, "compare")
    if value is None or value == "false":
        return False
    if value == "true":
        return True
    raise AnalyticsHttpError(400, "invalid_request", "compare must be true or false")


def _usage(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    """What agent work spent in a period: `from`, `to`, `step`, `utc_offset`, `group_by`,
    a filter per dimension, `none` and `compare`."""

    _refuse_unknown(parameters, _PARAMETERS)
    request = usage.query(
        start=query_params.required(parameters, "from", error=AnalyticsHttpError),
        end=query_params.required(parameters, "to", error=AnalyticsHttpError),
        step=_first(parameters, "step") or "day",
        utc_offset=_offset(parameters),
        group_by=_list(parameters, "group_by"),
        filters={
            dimension: _list(parameters, dimension)
            for dimension in usage.DIMENSIONS
            if _first(parameters, dimension) is not None
        },
        none=_list(parameters, "none"),
        compare=_compare(parameters),
    )
    return {"interface_version": ANALYTICS_API_INTERFACE, "usage": usage.read(conn, request)}


def _uses(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    """How often each analytics surface was opened on the days from `from` up to `to`."""

    _refuse_unknown(parameters, frozenset({"from", "to"}))
    return {
        "interface_version": ANALYTICS_API_INTERFACE,
        "uses": uses.read(
            conn,
            query_params.required(parameters, "from", error=AnalyticsHttpError),
            query_params.required(parameters, "to", error=AnalyticsHttpError),
        ),
    }


_READS: dict[str, Callable[[sqlite3.Connection, Mapping[str, list[str]]], dict]] = {
    USAGE_PATH: _usage,
    USES_PATH: _uses,
}


def handle_get(
    conn: sqlite3.Connection, path: str, parameters: Mapping[str, list[str]]
) -> tuple[int, dict] | None:
    """Answer one read, or return None when the path is not ours."""

    reader = _READS.get(path)
    if reader is None:
        return None
    return 200, reader(conn, parameters)


READ_PATHS = tuple(sorted(_READS))
WRITE_PATHS = (USES_PATH,)


def _use(payload: Mapping[str, object]) -> tuple[str, int]:
    """The kind and the offset of one use, as `{"kind": ..., "utc_offset": ...}` states them."""

    if set(payload) != {"kind", "utc_offset"}:
        raise AnalyticsHttpError(
            400, "invalid_request", "a use is an object of kind and utc_offset alone"
        )
    kind, offset = payload["kind"], payload["utc_offset"]
    if not isinstance(kind, str):
        raise AnalyticsHttpError(400, "invalid_request", "kind must be a string")
    # A JSON `true` arrives as an `int` too, and is no number of minutes.
    if not isinstance(offset, int) or isinstance(offset, bool):
        raise AnalyticsHttpError(
            400, "invalid_request", "utc_offset must be a whole number of minutes"
        )
    return kind, offset


def handle_post(
    conn: sqlite3.Connection, path: str, payload: Mapping[str, object]
) -> tuple[int, dict] | None:
    """Count one use, committed when this returns, or return None when the path is not ours."""

    if path != USES_PATH:
        return None
    kind, offset = _use(payload)
    return 200, {
        "interface_version": ANALYTICS_API_INTERFACE,
        "use": uses.record(conn, kind, offset),
    }


__all__ = [
    "ANALYTICS_API_INTERFACE",
    "READ_PATHS",
    "USAGE_PATH",
    "USES_PATH",
    "WRITE_PATHS",
    "AnalyticsHttpError",
    "error_response",
    "handle_get",
    "handle_post",
]
