"""The HTTP boundary of Improvements: which path means which operation.

Every other module here has one of these — `planning/api.py`, `memory/api.py`,
`executions/api.py` — and Improvements did not: the runtime that supervises
analyzer jobs also matched wire paths, so both surfaces called it with literal
path strings and a router lived inside a job supervisor. The operations it
dispatches to are named now, and this is the only place that knows a path.

Two paths carry an id, which is why the tables below are not purely flat: a case
and a job are addressed by number. The patterns are anchored and the id is
bounded, so a path either names one existing thing or is not ours at all.

The runtime arrives as an argument rather than being fetched from `watchers`
here. A boundary that reaches for its own collaborator cannot be tested against
a different one, and `Runtime` below states exactly what it needs — five
operations, none of them about HTTP.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Protocol

from .contract import ImprovementError
from .improvements import API_VERSION, ImprovementStore
from .improvements_integration import resolve_store
from .job_supervisor import JobError

PREFIX = "/api/modules/improvements"
SNAPSHOT_PATH = PREFIX
PROFILE_PATH = f"{PREFIX}/profile"
CASES_PATH = f"{PREFIX}/cases"
SIGNALS_PATH = f"{PREFIX}/signals"
ANALYZE_PATH = f"{PREFIX}/analyze"
EVAL_RUNS_PATH = f"{PREFIX}/eval-runs"
CASE_PATH = re.compile(rf"^{re.escape(PREFIX)}/cases/(?P<id>[1-9][0-9]*)$")
ACTION_PATH = re.compile(rf"^{re.escape(PREFIX)}/cases/(?P<id>[1-9][0-9]*)/actions$")
JOB_CANCEL_PATH = re.compile(rf"^{re.escape(PREFIX)}/jobs/(?P<id>[1-9][0-9]*)/cancel$")

READ_PATHS = (SNAPSHOT_PATH, PROFILE_PATH, CASES_PATH)
WRITE_PATHS = (SIGNALS_PATH, ANALYZE_PATH, EVAL_RUNS_PATH)


class Runtime(Protocol):
    """What this boundary needs from the process-wide Improvements runtime."""

    def record_signals(self, primary_db: str, payload: Mapping[str, object]) -> dict: ...

    def queue_analysis(self, primary_db: str, scope_name: str, trigger: str) -> dict: ...

    def queue_eval(self, primary_db: str, payload: Mapping[str, object]) -> dict: ...

    def cancel_job(self, primary_db: str, scope_name: str, job_id: int) -> dict: ...

    def act_on_case(self, primary_db: str, case_id: int, payload: Mapping[str, object]) -> dict: ...

    def set_profile(self, primary_db: str, payload: Mapping[str, object]) -> dict: ...


def handle_get(
    primary_db: str, path: str, parameters: Mapping[str, list[str]]
) -> tuple[int, dict] | None:
    """Answer one read, or return None when the path is not ours."""

    if not path.startswith(PREFIX):
        return None
    store = resolve_store(primary_db, (parameters.get("scope") or [""])[0])
    if path == SNAPSHOT_PATH:
        return 200, store.read_model()
    if path == PROFILE_PATH:
        return 200, store.profile() | {"signal_summary": store.signal_summary()}
    if path == CASES_PATH:
        given = parameters.get("state") or []
        state = given[0] if given else None
        raw_limit = (parameters.get("limit") or ["100"])[0]
        try:
            limit = int(raw_limit)
        except (TypeError, ValueError) as error:
            raise ImprovementError("invalid_limit", "limit must be an integer") from error
        return 200, {
            "interface_version": API_VERSION,
            "scope": store.scope,
            "cases": store.cases(state, limit),
            "signal_summary": store.signal_summary(),
        }
    case = CASE_PATH.fullmatch(path)
    if case:
        return 200, case_response(store, int(case.group("id")))
    return None


def handle_post(
    runtime: Runtime, primary_db: str, path: str, payload: Mapping[str, object]
) -> tuple[int, dict] | None:
    """Answer one write, or return None when the path is not ours."""

    if not path.startswith(PREFIX):
        return None
    if path == SIGNALS_PATH:
        result = runtime.record_signals(primary_db, payload)
        # 201 only when this call is what recorded it: the same packet arriving
        # twice is the dedup working, not a second creation.
        return (201 if result["recorded"] else 200), result
    if path == ANALYZE_PATH:
        return 202, runtime.queue_analysis(
            primary_db, str(payload.get("scope", "")), str(payload.get("trigger", "manual"))
        )
    if path == EVAL_RUNS_PATH:
        return 202, runtime.queue_eval(primary_db, payload)
    cancel = JOB_CANCEL_PATH.fullmatch(path)
    if cancel:
        return 200, runtime.cancel_job(
            primary_db, str(payload.get("scope", "")), int(cancel.group("id"))
        )
    action = ACTION_PATH.fullmatch(path)
    if action:
        return 200, runtime.act_on_case(primary_db, int(action.group("id")), payload)
    return None


def handle_put(
    runtime: Runtime, primary_db: str, path: str, payload: Mapping[str, object]
) -> tuple[int, dict] | None:
    if path != PROFILE_PATH:
        return None
    return 200, runtime.set_profile(primary_db, payload)


def case_response(store: ImprovementStore, case_id: int) -> dict:
    return {
        "interface_version": API_VERSION,
        "scope": store.scope,
        "signal_summary": store.signal_summary(),
    } | store.case(case_id)


def error_response(error: Exception) -> tuple[int, dict]:
    if isinstance(error, ImprovementError):
        return error.status, error.payload()
    if isinstance(error, JobError):
        return 409 if "already" in str(error) else 422, {
            "interface_version": API_VERSION,
            "error": {"code": "job_error", "message": str(error)},
        }
    return 422, {
        "interface_version": API_VERSION,
        "error": {"code": "invalid_request", "message": str(error)},
    }
