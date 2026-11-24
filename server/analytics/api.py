"""The Analytics boundary: its reads, its one write and its refusals, with no transport.

Like Planning's and Memory's, every function takes a connection, a path and the parsed
query or body and returns `(status, body)`; the HTTP surface adds the framing. No MCP
tool reads or writes this: the numbers would cost an agent context, as the per-item
read's would, and a use is counted by the page a person opened.

A list travels as one parameter with its values separated by commas, because a repeated
parameter is refused everywhere (`query_params`).
"""

from __future__ import annotations

import datetime as dt
import sqlite3
import time
from collections.abc import Callable, Mapping

from .. import query_params
from ..quota import accounts
from . import pauses, quota, usage, uses

ANALYTICS_API_INTERFACE = "valkama-analytics-api"
USAGE_PATH = "/api/analytics/usage"
#: Each account's subscription quota windows as they stand now.
QUOTA_PATH = "/api/analytics/quota"
#: One past window of one account: the latest of a kind that reset at or before a moment.
QUOTA_WINDOW_PATH = "/api/analytics/quota/window"
#: How often each analytics surface was opened: read by `GET`, counted by `POST`.
USES_PATH = "/api/analytics/uses"
#: How much of the prompt cache requests read after pauses of each length (`pauses`).
PAUSES_PATH = "/api/analytics/pauses"

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


def _quota(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    """Each account's quota windows now, its times at `utc_offset`; given `from`, the start
    of a page's period, each window of a share with the windows before it since then."""

    _refuse_unknown(parameters, frozenset({"utc_offset", "from"}))
    period_from = None if _first(parameters, "from") is None else _time(parameters, "from")
    return {
        "interface_version": ANALYTICS_API_INTERFACE,
        "quota": quota.read(conn, _offset(parameters), period_from=period_from),
    }


#: How long one read of the pauses parses transcripts before it answers how far it got: well
#: inside the browser's wait for an answer, which is 15 seconds.
PAUSES_BUDGET_SECONDS = 8.0


def _pauses(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> tuple[int, dict]:
    """The pauses before model requests over `from` to `to`, a date at `utc_offset` or a time
    with its offset as the usage read takes them, read in whole hours (`pauses`); `project`
    narrows it to the runs with work in that project, as the usage read places work.

    A read that has not parsed every run's transcript within `PAUSES_BUDGET_SECONDS` answers 202
    with how many runs it read and how many are left (`reading`); what it read is kept, so the
    same read asked again goes on from there and in the end answers 200 with the report.
    """

    _refuse_unknown(parameters, frozenset({"from", "to", "utc_offset", "project"}))
    period = usage.query(
        start=query_params.required(parameters, "from", error=AnalyticsHttpError),
        end=query_params.required(parameters, "to", error=AnalyticsHttpError),
        utc_offset=_offset(parameters),
    )
    project = _first(parameters, "project")
    until = time.monotonic() + PAUSES_BUDGET_SECONDS
    try:
        report = pauses.read(
            conn, start=period.start / 1e6, end=period.end / 1e6, project=project, until=until
        )
    except pauses.UnfinishedError as unfinished:
        reading = {"runs_read": unfinished.read, "runs_left": unfinished.left}
        return 202, {"interface_version": ANALYTICS_API_INTERFACE, "reading": reading}
    return 200, {"interface_version": ANALYTICS_API_INTERFACE, "pauses": report}


#: The longest model name a window of one model's week is asked for by.
_MODEL_LENGTH = 64


def close() -> None:
    """Stop what the reads keep running past an answer: the pool the pauses read parses with."""

    pauses.READER.close()


def _time(parameters: Mapping[str, list[str]], name: str) -> dt.datetime:
    """The parameter `name`, required, as a time with its offset."""

    text = query_params.required(parameters, name, error=AnalyticsHttpError)
    refusal = f"{name} must be a time with its offset"
    try:
        moment = dt.datetime.fromisoformat(text)
    except ValueError as error:
        raise AnalyticsHttpError(400, "invalid_request", refusal) from error
    if moment.tzinfo is None:
        raise AnalyticsHttpError(400, "invalid_request", refusal)
    return moment


def _quota_window(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    """One past window of `account`, of `kind` and, for a model's week, `model`: the latest
    that reset at or before `before`, its times at `utc_offset`."""

    _refuse_unknown(parameters, frozenset({"utc_offset", "account", "kind", "model", "before"}))
    account = query_params.required(parameters, "account", error=AnalyticsHttpError)
    if not accounts.is_account_key(account):
        raise AnalyticsHttpError(400, "invalid_request", "account must be an account's key")
    kind = query_params.required(parameters, "kind", error=AnalyticsHttpError)
    if kind not in quota.SHARE_KINDS:
        raise AnalyticsHttpError(
            400, "invalid_request", f"kind must be one of {', '.join(quota.SHARE_KINDS)}"
        )
    model = _first(parameters, "model")
    if (kind == "week_model") != (model is not None):
        raise AnalyticsHttpError(
            400, "invalid_request", "model is given for a model's week and for no other kind"
        )
    if model is not None and len(model) > _MODEL_LENGTH:
        raise AnalyticsHttpError(
            400, "invalid_request", f"model must be at most {_MODEL_LENGTH} characters"
        )
    return {
        "interface_version": ANALYTICS_API_INTERFACE,
        "quota_window": quota.past(
            conn,
            _offset(parameters),
            account=account,
            kind=kind,
            model=model,
            before=_time(parameters, "before"),
        ),
    }


#: Each read by its path: its answer, or its status and answer where it can be other than 200.
_READS: dict[
    str, Callable[[sqlite3.Connection, Mapping[str, list[str]]], dict | tuple[int, dict]]
] = {
    PAUSES_PATH: _pauses,
    QUOTA_PATH: _quota,
    QUOTA_WINDOW_PATH: _quota_window,
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
    answer = reader(conn, parameters)
    return answer if isinstance(answer, tuple) else (200, answer)


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
    "PAUSES_PATH",
    "QUOTA_PATH",
    "QUOTA_WINDOW_PATH",
    "READ_PATHS",
    "USAGE_PATH",
    "USES_PATH",
    "WRITE_PATHS",
    "AnalyticsHttpError",
    "close",
    "error_response",
    "handle_get",
    "handle_post",
]
