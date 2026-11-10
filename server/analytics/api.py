"""The Analytics boundary: its reads and its refusals, with no transport in them.

Like Planning's and Memory's, every function takes a connection, a path and the parsed
query and returns `(status, body)`; the HTTP surface adds the framing. No MCP tool reads
this: the numbers would cost an agent context, as the per-item read's would.

A list travels as one parameter with its values separated by commas, because a repeated
parameter is refused everywhere (`query_params`).
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable, Mapping

from .. import query_params
from . import usage

ANALYTICS_API_INTERFACE = "valkama-analytics-api"
USAGE_PATH = "/api/analytics/usage"

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
    if isinstance(error, usage.UsageQueryError):
        return 400, {"error": {"code": "invalid_request", "message": str(error)}}
    raise error


def _first(parameters: Mapping[str, list[str]], name: str) -> str | None:
    return query_params.first(parameters, name, error=AnalyticsHttpError)


def _list(parameters: Mapping[str, list[str]], name: str) -> list[str]:
    value = _first(parameters, name)
    return [] if value is None else value.split(",")


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

    unknown = sorted(set(parameters) - _PARAMETERS)
    if unknown:
        raise AnalyticsHttpError(400, "invalid_request", f"{unknown[0]} is not a parameter")
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


_READS: dict[str, Callable[[sqlite3.Connection, Mapping[str, list[str]]], dict]] = {
    USAGE_PATH: _usage,
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

__all__ = [
    "ANALYTICS_API_INTERFACE",
    "READ_PATHS",
    "USAGE_PATH",
    "AnalyticsHttpError",
    "error_response",
    "handle_get",
]
