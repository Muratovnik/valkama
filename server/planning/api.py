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

import contextlib
import sqlite3
from collections.abc import Callable, Iterator, Mapping
from typing import Any

from .. import query_params
from . import calls, chain, migration, model, read_model, requests, service, views

PLANNING_API_INTERFACE = f"{model.PLANNING_INTERFACE}-api"


class PlanningHttpError(Exception):
    """A refusal with the status the surface should report.

    `detail` is carried beside the code and the message in the error body, for
    a refusal that has more to say than one sentence: which step of a batch.
    """

    def __init__(
        self, status: int, code: str, message: str, detail: Mapping[str, object] | None = None
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.detail = dict(detail or {})


def _first(parameters: Mapping[str, list[str]], name: str) -> str | None:
    return query_params.first(parameters, name, error=PlanningHttpError)


def _required(parameters: Mapping[str, list[str]], name: str) -> str:
    return query_params.required(parameters, name, error=PlanningHttpError)


def _int(value: object, name: str, default: int) -> int:
    if value is None:
        return default
    try:
        number = int(str(value), 10)
    except ValueError as error:
        raise PlanningHttpError(400, "invalid_request", f"{name} must be an integer") from error
    if abs(number) > model.MAX_COUNT:
        raise PlanningHttpError(400, "invalid_request", f"{name} must be an integer")
    return number


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
        return error.status, {
            "error": {"code": error.code, "message": error.message, **error.detail}
        }
    if isinstance(error, model.RevisionConflictError):
        return 409, {
            "error": {
                "code": "revision_conflict",
                "message": str(error),
                "expected": error.expected,
                "actual": error.actual,
            }
        }
    if isinstance(error, model.WorkItemNotFoundError):
        return 404, {"error": {"code": "not_found", "message": str(error)}}
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
    if _first(parameters, "limit") is not None:
        raise PlanningHttpError(
            400,
            "invalid_request",
            "The complete read model does not accept limit; use /api/planning/work-items",
        )
    return views.planning_payload(conn, space=_chosen_space(conn, parameters))


def _graph(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    return views.graph_payload(conn, space=_chosen_space(conn, parameters))


def _activity(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    return {
        "interface_version": PLANNING_API_INTERFACE,
        "activity": views.activity_feed(conn, _int(_first(parameters, "limit"), "limit", 100)),
    }


def _count(parameters: Mapping[str, list[str]], name: str) -> int | None:
    """A count a read takes, or None when it is absent.

    Refused as a domain error, so both surfaces carry its code.
    """

    value = _first(parameters, name)
    if value is None:
        return None
    try:
        count = int(value, 10)
    except ValueError:
        count = -1
    if not 0 <= count <= model.MAX_COUNT:
        raise model.PlanningError(f"{name} must be a non-negative integer")
    return count


def _offset(parameters: Mapping[str, list[str]]) -> int:
    """Where a page starts."""

    return _count(parameters, "offset") or 0


def _switch(parameters: Mapping[str, list[str]], name: str) -> bool:
    """A boolean query parameter: `true`, `false`, or absent for false."""

    value = _first(parameters, name)
    if value is None or value == "false":
        return False
    if value == "true":
        return True
    raise PlanningHttpError(400, "invalid_request", f"{name} must be true or false")


def _work_items(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    return {
        "interface_version": PLANNING_API_INTERFACE,
        **service.list_work_items_page(
            conn,
            space=_first(parameters, "space"),
            state_key=_first(parameters, "state"),
            category=_first(parameters, "category"),
            kind=_first(parameters, "kind"),
            owner=_first(parameters, "owner"),
            parent=_first(parameters, "parent"),
            limit=_int(_first(parameters, "limit"), "limit", 200),
            offset=_offset(parameters),
        ),
    }


def _work_item(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    """One item. Every cut of its history is opt-in; without them, the full record."""

    return {
        "interface_version": PLANNING_API_INTERFACE,
        "work_item": service.get_work_item(
            conn,
            _required(parameters, "id"),
            comments=_count(parameters, "comments"),
            comments_after=_count(parameters, "comments_after") or 0,
            events=_count(parameters, "events"),
            sessions=_switch(parameters, "sessions"),
        ),
    }


def _chain(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    """The chain of work rooted at one item: `scope` is `chain` (the default) or `epic`."""

    scope = _first(parameters, "scope")
    return {
        "interface_version": PLANNING_API_INTERFACE,
        "chain": chain.chain(
            conn, _required(parameters, "id"), "chain" if scope is None else scope
        ),
    }


def _search(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    return {
        "interface_version": PLANNING_API_INTERFACE,
        **service.search_work_items_page(
            conn,
            _required(parameters, "q"),
            space=_first(parameters, "space"),
            limit=_int(_first(parameters, "limit"), "limit", 50),
            offset=_offset(parameters),
        ),
    }


def _requests(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    return {
        "interface_version": "valkama-planning-requests",
        "requests": requests.list_requests(
            conn,
            space=_first(parameters, "space"),
            reference=_first(parameters, "id"),
            status=_first(parameters, "status"),
            answered_after=_first(parameters, "answered_after"),
            limit=_int(_first(parameters, "limit"), "limit", 100),
        ),
    }


def _request(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    return {
        "interface_version": "valkama-planning-requests",
        "request": requests.get(conn, _required(parameters, "id")),
    }


_READS: dict[str, Callable[[sqlite3.Connection, Mapping[str, list[str]]], dict]] = {
    "/api/planning": _read_model,
    "/api/planning/spaces": _spaces,
    "/api/planning/graph": _graph,
    "/api/planning/activity": _activity,
    "/api/planning/work-items": _work_items,
    # The id travels as a parameter rather than a path segment, which is what
    # every other exact read on this surface already does; the HTTP dispatch
    # keys on exact paths and a segment would need a second matching rule.
    "/api/planning/work-item": _work_item,
    "/api/planning/work-item/chain": _chain,
    "/api/planning/search": _search,
    "/api/planning/requests": _requests,
    "/api/planning/request": _request,
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
    answer = writer(conn, payload)
    # Every write call has its row, including one that logged nothing — an edit,
    # a claim that found itself already held, a take-next with nothing to take.
    # Inside a bound call this finds the row a write already inserted; outside
    # one it does nothing.
    calls.call_id(conn, calls.acted_on(answer))
    return 200, answer


def _create(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    """A new item, then its claim, its checklist and its links, as one all-or-nothing change.

    Each step after the creation is the write its single tool makes, inside one
    savepoint with the creation, so a refused link or claim leaves no item, no
    spent number and no call row behind. Without `claim` or `links` the answer
    is the one this route always gave; with them it adds `applied`.
    """

    steps = _steps(payload, CREATE_GROUPS)
    if not steps:
        return _created(conn, payload)
    with _all_or_nothing(conn):
        item = _created(conn, payload)
        base: dict[str, object] = {"id": str(item["work_item_id"])}
        if "author" in payload:
            base["author"] = payload["author"]
        findings, applied = _run_steps(conn, base, steps)
        answer = service.get_work_item(conn, str(item["work_item_id"]))
    return {**answer, **findings, "applied": applied}


def _created(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
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
        rank=_optional_text(payload, "rank"),
        expected_revision=_optional_int(payload, "expected_revision"),
        author=_author(payload),
    )


def _delete(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    return service.delete_work_item(conn, _text(payload, "id"))


def _transition(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    return service.transition_work_item(
        conn,
        _text(payload, "id"),
        _text(payload, "state"),
        reason=str(payload.get("reason") or ""),
        force=_flag(payload, "force"),
        rank=_optional_text(payload, "rank"),
        expected_revision=_optional_int(payload, "expected_revision"),
        author=_author(payload),
    )


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


def _merge(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    return service.merge_work_items(
        conn,
        _text(payload, "id"),
        _field(payload, "items"),
        reason=str(payload.get("reason") or ""),
        force=_flag(payload, "force"),
        expected_revision=_optional_int(payload, "expected_revision"),
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
        conn,
        _text(payload, "id"),
        _text(payload, "body"),
        author=_author(payload),
        checklist_item_id=_optional_text(payload, "checklist_item_id"),
    )


def _request_fields(payload: Mapping[str, object], allowed: set[str]) -> None:
    if set(payload) - allowed:
        raise PlanningHttpError(400, "invalid_request", "request has unknown fields")


def _create_request(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    _request_fields(
        payload,
        {"id", "kind", "prompt", "fields", "author", "execution_id", "session_id", "expires_at"},
    )
    return requests.create(
        conn,
        _text(payload, "id"),
        kind=_field(payload, "kind"),
        prompt=_field(payload, "prompt"),
        fields=_field(payload, "fields"),
        author=_author(payload),
        execution_id=_optional_text(payload, "execution_id"),
        session_id=_optional_text(payload, "session_id"),
        expires_at=_optional_text(payload, "expires_at"),
    )


def _answer_request(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    _request_fields(payload, {"id", "answers", "note", "expected_revision", "author"})
    return requests.resolve(
        conn,
        _text(payload, "id"),
        status="answered",
        expected_revision=_field(payload, "expected_revision"),
        answers=_field(payload, "answers"),
        note=payload.get("note"),
        author=_author(payload),
    )


def _decline_request(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    _request_fields(payload, {"id", "expected_revision", "author"})
    return requests.resolve(
        conn,
        _text(payload, "id"),
        status="declined",
        expected_revision=_field(payload, "expected_revision"),
        author=_author(payload),
    )


def _expire_request(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    _request_fields(payload, {"id", "expected_revision", "author"})
    return requests.resolve(
        conn,
        _text(payload, "id"),
        status="expired",
        expected_revision=_field(payload, "expected_revision"),
        author=_author(payload),
    )


def _report(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    return service.report_work_item(
        conn,
        _text(payload, "id"),
        _field(payload, "report"),
        make_current=_flag(payload, "make_current"),
        expected_revision=_optional_int(payload, "expected_revision"),
        author=_author(payload),
    )


def _select_summary(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    comment_id = _field(payload, "comment_id")
    if not isinstance(comment_id, int) or isinstance(comment_id, bool):
        raise PlanningHttpError(400, "invalid_request", "comment_id must be an integer")
    return service.select_summary(
        conn,
        _text(payload, "id"),
        comment_id,
        expected_revision=_optional_int(payload, "expected_revision"),
        author=_author(payload),
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
    """The author the payload names, or the one its call implies.

    A browser write that names nobody is the owner's, and signing it with
    Planning's `agent` fallback is how a claim made by hand read as an agent's.
    """

    value = payload.get("author")
    if value is None or value == "":
        return calls.default_author()
    if not isinstance(value, str):
        raise PlanningHttpError(400, "invalid_request", "author must be a string")
    return value


#: What a batch may change, in the order it applies them, with the fields each
#: entry may name. The order is the contract: a closing transition is judged
#: after the ticks and the summary sent beside it.
APPLY_GROUPS: tuple[tuple[str, frozenset[str]], ...] = (
    ("claim", frozenset()),
    ("checklist", frozenset({"items", "force"})),
    ("checklist_ticks", frozenset({"item_id", "done"})),
    ("refs", frozenset({"kind", "value", "label"})),
    ("links", frozenset({"other", "kind", "remove"})),
    ("comment", frozenset({"body", "checklist_item_id"})),
    ("summary", frozenset({"done", "next", "why"})),
    ("transition", frozenset({"state", "reason", "force", "rank"})),
)
#: What a creation may do to the item it just made, after making it and in this
#: order. A link from a new item has nothing to remove, so `remove` is not taken.
CREATE_GROUPS: tuple[tuple[str, frozenset[str]], ...] = (
    ("claim", frozenset()),
    ("checklist", frozenset({"items"})),
    ("links", frozenset({"other", "kind"})),
)
#: The groups that are lists of entries rather than one object.
_APPLY_LISTS = frozenset({"checklist_ticks", "refs", "links"})
#: The most entries one list in a batch may hold.
MAX_APPLY_ENTRIES = 100

_Step = tuple[str, int, Mapping[str, object]]


def _apply_entries(payload: Mapping[str, object]) -> list[_Step]:
    """Every step a batch names, in application order; a batch must name one."""

    steps = _steps(payload, APPLY_GROUPS)
    if not steps:
        raise PlanningHttpError(
            400,
            "invalid_request",
            "a batch needs at least one change: "
            + ", ".join(group for group, _fields in APPLY_GROUPS),
        )
    return steps


def _steps(
    payload: Mapping[str, object], groups: tuple[tuple[str, frozenset[str]], ...]
) -> list[_Step]:
    """Every step the payload names, in application order, refused before anything is written.

    A step is its group, its index within the group and its fields. `claim`
    is a boolean, so `false` names no step.
    """

    steps: list[_Step] = []
    for group, fields in groups:
        value = payload.get(group)
        if value is None:
            continue
        if group == "claim":
            if not isinstance(value, bool):
                raise PlanningHttpError(400, "invalid_request", "claim must be a boolean")
            if value:
                steps.append((group, 0, {}))
            continue
        entries = value if group in _APPLY_LISTS else [value]
        if not isinstance(entries, list) or len(entries) > MAX_APPLY_ENTRIES:
            raise PlanningHttpError(
                400,
                "invalid_request",
                f"{group} must be a list of at most {MAX_APPLY_ENTRIES} objects",
            )
        for index, entry in enumerate(entries):
            label = f"{group}[{index}]" if group in _APPLY_LISTS else group
            if not isinstance(entry, Mapping):
                raise PlanningHttpError(400, "invalid_request", f"{label} must be an object")
            unknown = sorted(set(entry) - fields)
            if unknown:
                raise PlanningHttpError(
                    400,
                    "invalid_request",
                    f"{label}: unknown field(s) {', '.join(unknown)}; expected"
                    f" {', '.join(sorted(fields))}",
                )
            steps.append((group, index, entry))
    return steps


def _apply_step(
    conn: sqlite3.Connection, group: str, base: Mapping[str, object], entry: Mapping[str, object]
) -> tuple[dict, object]:
    """Run one step through the write the single tool uses, and say what it changed."""

    if group == "claim":
        claimed = _claim(conn, base)
        return {name: claimed[name] for name in ("started", "warnings") if claimed.get(name)}, True
    if group == "checklist":
        replaced = _checklist(conn, {**entry, **base})
        return {}, [
            {"item_id": step["id"], "text": step["text"], "done": step["done"]}
            for step in replaced["checklist"]
        ]
    if group == "checklist_ticks":
        _checklist_tick(conn, {**entry, **base})
        return {}, {"item_id": entry.get("item_id"), "done": entry.get("done", True)}
    if group == "refs":
        _ref(conn, {**entry, **base})
        return {}, 1
    if group == "links":
        _link(conn, {**entry, **base})
        return {}, 1
    if group == "comment":
        return {}, {"comment_id": _comment(conn, {**entry, **base})["comment_id"]}
    if group == "summary":
        answer = _summary(conn, {**base, "summary": dict(entry)})
        return {}, {"summary_comment_id": answer["summary_comment_id"]}
    answer = _transition(conn, {**entry, **base})
    found = {name: answer[name] for name in ("warnings", "overridden") if answer.get(name)}
    moved = {"state": answer["state"]["key"]}
    if answer.get("released"):
        moved["released"] = answer["released"]
    return found, moved


def _apply(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    """Several writes to one work item as one all-or-nothing change.

    Each step is the very write its single tool makes, with that tool's guards,
    events and revision bump, inside one savepoint: a refused step rolls back
    every step before it, even for a caller that commits after catching the
    refusal. The call row is the batch's, so one call is recorded however many
    steps it took. `expected_revision` is checked once, against the item as the
    batch found it.
    """

    reference = _text(payload, "id")
    expected = _optional_int(payload, "expected_revision")
    steps = _apply_entries(payload)
    base: dict[str, object] = {"id": reference}
    if "author" in payload:
        base["author"] = payload["author"]
    with _all_or_nothing(conn):
        actual = int(read_model.item_row(conn, reference)["revision"])
        if expected is not None and expected != actual:
            raise model.RevisionConflictError(expected, actual)
        findings, applied = _run_steps(conn, base, steps)
        answer = service.get_work_item(conn, reference)
    return {**answer, **findings, "applied": applied}


@contextlib.contextmanager
def _all_or_nothing(conn: sqlite3.Connection) -> Iterator[None]:
    """One savepoint around several writes: a refusal anywhere rolls every one of them back.

    The savepoint, not the caller's rollback, is what keeps a refused step's
    predecessors out of the store, because the HTTP surface commits whatever a
    handler leaves. Opened inside a transaction the caller already holds, it
    commits nothing on the caller's behalf.
    """

    if not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")
    conn.execute("SAVEPOINT planning_batch")
    try:
        yield
    except BaseException:
        conn.execute("ROLLBACK TO planning_batch")
        conn.execute("RELEASE planning_batch")
        raise
    conn.execute("RELEASE planning_batch")


def _run_steps(
    conn: sqlite3.Connection, base: Mapping[str, object], steps: list[_Step]
) -> tuple[dict, dict[str, Any]]:
    """Run each step in order; the findings a caller must not miss, and what each group changed.

    A refusal keeps its status and code, prefixes its message with the step and
    names the step beside it, so the caller can tell which entry to fix.
    """

    findings: dict = {}
    applied: dict[str, Any] = {}
    for group, index, entry in steps:
        try:
            extra, change = _apply_step(conn, group, base, entry)
        except (model.PlanningError, PlanningHttpError) as error:
            status, body = error_response(error)
            label = f"{group}[{index}]" if group in _APPLY_LISTS else group
            detail = {
                name: value
                for name, value in body["error"].items()
                if name not in ("code", "message")
            }
            raise PlanningHttpError(
                status,
                str(body["error"]["code"]),
                f"{label}: {body['error']['message']}",
                {**detail, "step": {"group": group, "index": index}},
            ) from error
        # A claim's start and a transition may both warn; neither hides the other.
        warnings = [*findings.get("warnings", []), *extra.pop("warnings", [])]
        findings.update(extra)
        if warnings:
            findings["warnings"] = warnings
        if group == "checklist_ticks":
            applied.setdefault(group, []).append(change)
        elif group in _APPLY_LISTS:
            applied[group] = applied.get(group, 0) + 1
        else:
            applied[group] = change
    return findings, applied


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
    "/api/planning/work-item/merge": _merge,
    "/api/planning/work-item/summary": _summary,
    "/api/planning/work-item/comment": _comment,
    "/api/planning/work-item/report": _report,
    "/api/planning/work-item/summary/select": _select_summary,
    "/api/planning/work-item/ref": _ref,
    "/api/planning/work-item/apply": _apply,
    "/api/planning/work-item/request": _create_request,
    "/api/planning/request/answer": _answer_request,
    "/api/planning/request/decline": _decline_request,
    "/api/planning/request/expire": _expire_request,
}

READ_PATHS = tuple(sorted(_READS))
WRITE_PATHS = tuple(sorted(_WRITES))
