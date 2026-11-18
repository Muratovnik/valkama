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
from . import (
    calls,
    chain,
    commits,
    goal_volumes,
    held,
    images,
    item_projects,
    live_frame,
    mention_records,
    model,
    participants,
    read_model,
    requests,
    sections,
    service,
    split,
    subscriptions,
    usage,
    views,
    volumes,
    waiting,
)

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
    if isinstance(error, images.ImageRefusedError):
        return error.status, {"error": {"code": error.code, "message": str(error)}}
    if isinstance(error, model.WorkItemNotFoundError):
        return 404, {"error": {"code": "not_found", "message": str(error)}}
    if isinstance(error, model.CancelListError):
        # Before the guard it is a kind of: its body is the list the caller confirms.
        return 409, {
            "error": {
                "code": "cancel_list",
                "message": str(error),
                "cancels": error.cancels,
                "dependents": error.dependents,
                "list_token": error.list_token,
            }
        }
    if isinstance(error, model.WorkflowGuardError):
        return 409, {"error": {"code": "workflow_guard", "message": str(error)}}
    if isinstance(error, model.MentionLimitError):
        return 429, {"error": {"code": "mention_limit", "message": str(error)}}
    if isinstance(error, model.AskLimitError):
        return 429, {"error": {"code": "ask_limit", "message": str(error)}}
    if isinstance(error, model.NotAddressedError):
        return 403, {"error": {"code": "not_addressed", "message": str(error)}}
    if isinstance(error, model.NotAskerError):
        return 403, {"error": {"code": "not_asker", "message": str(error)}}
    if isinstance(error, model.OwnerOnlyError):
        return 403, {"error": {"code": "owner_only", "message": str(error)}}
    if isinstance(error, model.StoreSchemaError):
        return 409, {"error": {"code": model.STORE_SCHEMA_MISMATCH, "message": str(error)}}
    if isinstance(error, model.PlanningError):
        return 400, {"error": {"code": "invalid_request", "message": str(error)}}
    raise error


# -- reads -------------------------------------------------------------------


def handle_get(
    conn: sqlite3.Connection,
    path: str,
    parameters: Mapping[str, list[str]],
    *,
    item_quota: usage.QuotaReader | None = None,
) -> tuple[int, dict] | None:
    """Answer one neutral read, or return None when the path is not ours.

    `item_quota` reads the quota of an item's usage, and only the item's usage read takes
    it: a caller that can read Quota passes it, and without it that read has no `quota`.
    """

    if path == _ITEM_USAGE:
        return 200, _item_usage(conn, parameters, item_quota)
    reader = _READS.get(path)
    if reader is None:
        return None
    return 200, reader(conn, parameters)


def _spaces(conn: sqlite3.Connection, _parameters: Mapping[str, list[str]]) -> dict:
    return {
        "interface_version": PLANNING_API_INTERFACE,
        "planning_spaces": item_projects.spaces_shown(conn, service.list_planning_spaces(conn)),
    }


def _chosen_space(parameters: Mapping[str, list[str]]) -> tuple[str | None, str | None]:
    """Which space the caller reads, the first when it names none, and the project narrowing it.

    A space holds no project, so a project does not name one: several spaces'
    projects are the registry's to bind, and one project may be named by items of
    any space. It narrows the read of the space named beside it.
    """

    space, project = _first(parameters, "space"), _first(parameters, "project")
    if project is not None and space is None:
        raise PlanningHttpError(
            400, "invalid_request", "a project does not choose a planning space: name the space"
        )
    return space, project


def _read_model(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    if _first(parameters, "limit") is not None:
        raise PlanningHttpError(
            400,
            "invalid_request",
            "The complete read model does not accept limit; use /api/planning/work-items",
        )
    space, project = _chosen_space(parameters)
    return views.planning_payload(conn, space=space, project=project)


def _graph(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    space, project = _chosen_space(parameters)
    return views.graph_payload(conn, space=space, project=project)


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
            state=_first(parameters, "state"),
            category=_first(parameters, "category"),
            kind=_first(parameters, "kind"),
            owner=_first(parameters, "owner"),
            parent=_first(parameters, "parent"),
            project=_first(parameters, "project"),
            # The list of a space is a read of it: other spaces' items naming its projects too.
            other_spaces=True,
            limit=_int(_first(parameters, "limit"), "limit", 200),
            offset=_offset(parameters),
        ),
    }


def _work_item(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    """One item. With `parts`, the parts it names; without, the full record.

    The full record is what a screen and every write answer with, and each cut of
    its history is opt-in; on a goal or a stage it carries who works on it, as every
    HTTP read of one item does. `parts` is a comma-separated list of
    `read_model.PARTS`; a comment mode beside it cuts the comments part and `events`
    names how many newest events the events part reads. `section`, which may repeat
    because a heading may hold a comma, names the sections the sections part reads
    with their text, and without `parts` reads that part alone.
    """

    names = _part_names(parameters)
    section = parameters.get("section")
    if names is None and section:
        names = ["sections"]
    if names is not None:
        return {
            "interface_version": PLANNING_API_INTERFACE,
            "work_item": _parts_of(
                conn,
                _required(parameters, "id"),
                names,
                comments_after=_count(parameters, "comments_after"),
                thread=_count(parameters, "thread"),
                unresolved=_switch(parameters, "unresolved"),
                events=_events_count(parameters),
                section=section or None,
            ),
        }
    return {
        "interface_version": PLANNING_API_INTERFACE,
        "work_item": service.get_work_item(
            conn,
            _required(parameters, "id"),
            comments=_count(parameters, "comments"),
            comments_after=_count(parameters, "comments_after") or 0,
            threads=_count(parameters, "threads"),
            thread=_count(parameters, "thread"),
            unresolved=_switch(parameters, "unresolved"),
            events=_count(parameters, "events"),
            sessions=_switch(parameters, "sessions"),
            participants=True,
        ),
    }


def _events_count(parameters: Mapping[str, list[str]]) -> int | None:
    """How many newest events the events part reads, or None for its default."""

    value = _first(parameters, "events")
    if value is None:
        return None
    try:
        number: object = int(value, 10)
    except ValueError:
        number = value
    return read_model.events_count(number)


def _part_names(parameters: Mapping[str, list[str]]) -> list[str] | None:
    """The parts a read names, each once in the order named, or None when it names none."""

    value = _first(parameters, "parts")
    if value is None:
        return None
    return read_model.part_names(name.strip() for name in value.split(","))


#: How each part but the card, the comments, the events and the sections is read, as the
#: field of its name.
_PART_READERS: dict[str, Callable[[sqlite3.Connection, sqlite3.Row], dict]] = {
    "links": lambda conn, row: {"links": read_model.links(conn, str(row["work_item_id"]))},
    "refs": lambda conn, row: {"refs": read_model.refs(conn, str(row["work_item_id"]))},
    "commits": lambda conn, row: {"commits": read_model.commits(conn, str(row["work_item_id"]))},
    "questions": lambda conn, row: {
        "questions": requests.item_questions(conn, str(row["work_item_id"]))
    },
    "mentions": lambda conn, row: dict(
        zip(
            ("mentions", "mentions_total"),
            read_model.mentions_of(conn, str(row["work_item_id"]), read_model.HTTP_MENTIONS),
            strict=True,
        )
    ),
    "sessions": lambda conn, row: {"sessions": read_model.sessions(conn, str(row["work_item_id"]))},
    "images": lambda conn, row: {"images": images.of_item(conn, str(row["work_item_id"]))},
    "subscribers": lambda conn, row: {
        "subscribers": subscriptions.subscribers(conn, str(row["work_item_id"]))
    },
    "claim": lambda conn, row: {"claim": read_model.claim(conn, row)},
    "participants": lambda conn, row: {"participants": _participants(conn, row)},
}


def _participants(conn: sqlite3.Connection, row: sqlite3.Row) -> list[dict]:
    """Who works on a goal or a stage. A task has no such part, so reading it is refused."""

    if str(row["kind"]) != model.CONTAINER_KIND:
        others = ", ".join(name for name in read_model.PARTS if name != "participants")
        raise model.PlanningError(f"unknown part 'participants'; a task's parts are {others}")
    return participants.of_container(conn, row)


def _card_counts(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, dict[str, int]]:
    """What the card's table of contents counts that `read_model` cannot: the questions,
    which `requests` reads, and on a goal or a stage the sessions working on it."""

    identity = str(row["work_item_id"])
    counted = {"questions": requests.question_counts(conn, identity)}
    if str(row["kind"]) == model.CONTAINER_KIND:
        counted["participants"] = {"count": len(participants.of_container(conn, row))}
    return counted


@read_model.whole_store_read()
def _parts_of(
    conn: sqlite3.Connection,
    reference: str,
    names: list[str],
    *,
    comments_after: int | None,
    thread: int | None,
    unresolved: bool,
    events: int | None = None,
    section: list[str] | None = None,
) -> dict:
    """The parts named of one item, beside its reference and the revision they were read at.

    A part no reader here names is the field of its name in the full record when the
    record has it, so a field a later build adds to the record is read as a part
    without a reader of its own; a part the record does not hold answers with nothing.
    A mode names the part it cuts, and a read that leaves that part out is refused
    rather than answered without what the mode asked for.
    """

    row = read_model.item_row(conn, reference)
    identity = str(row["work_item_id"])
    modes = {
        "thread": ("comments", thread),
        "unresolved": ("comments", unresolved or None),
        "comments_after": ("comments", comments_after),
        "events": ("events", events),
        "section": ("sections", section),
    }
    for mode, (cut, value) in modes.items():
        if value is not None and cut not in names:
            raise model.PlanningError(
                f"{mode} reads the {cut} part: add {cut} to parts or leave parts out"
            )
    answer: dict[str, object] = {
        "reference": read_model.reference(conn, row),
        "revision": int(row["revision"]),
    }
    for name in names:
        if name == "card":
            part = read_model.card(conn, row, counted=_card_counts(conn, row))
        elif name == "comments":
            part = read_model.comments_part(
                conn, row, comments_after=comments_after, thread=thread, unresolved=unresolved
            )
        elif name == "events":
            part = read_model.events_part(conn, row, events)
        elif name == "sections":
            described = str(row["description"])
            part = {
                "sections": sections.contents(described)
                if section is None
                else sections.named(described, section)
            }
        elif name in _PART_READERS:
            part = _PART_READERS[name](conn, row)
        else:
            record = service.get_work_item(conn, identity, comments=0, events=0)
            part = {name: record[name]} if name in record else {}
        answer.update(part)
    return answer


def _chain(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    """The chain of work rooted at one item: `scope` is `chain` (the default) or `tree`."""

    scope = _first(parameters, "scope")
    return {
        "interface_version": PLANNING_API_INTERFACE,
        "chain": chain.chain(
            conn, _required(parameters, "id"), "chain" if scope is None else scope
        ),
    }


def _item_usage(
    conn: sqlite3.Connection,
    parameters: Mapping[str, list[str]],
    quota: usage.QuotaReader | None = None,
) -> dict:
    """What work on one item took; `scope` `tree` or `chain` takes in what it grew into."""

    return {
        "interface_version": PLANNING_API_INTERFACE,
        "usage": usage.for_item(
            conn, _required(parameters, "id"), _first(parameters, "scope"), quota=quota
        ),
    }


def _session_usage(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    """What one session took, by item, with what no item took as a line of its own."""

    return {
        "interface_version": PLANNING_API_INTERFACE,
        "usage": usage.for_session(conn, _required(parameters, "session_id")),
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
        **requests.list_page(
            conn,
            space=_first(parameters, "space"),
            reference=_first(parameters, "id"),
            status=_first(parameters, "status"),
            answered_after=_first(parameters, "answered_after"),
            limit=_int(_first(parameters, "limit"), "limit", 100),
            offset=_offset(parameters),
            addressed=_switch(parameters, "addressed"),
        ),
    }


def _held(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    """The open items one agent session holds, for a reader showing them beside it."""

    return held.held_by_session(conn, _required(parameters, "session"))


def _request(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    return {
        "interface_version": "valkama-planning-requests",
        "request": requests.get(conn, _required(parameters, "id"), replies=True),
    }


def _unattached(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    """The commits on no card of a space's projects, of one project or of the whole store, newest first."""

    limit = _count(parameters, "limit")
    return commits.unattached(
        conn,
        space=_first(parameters, "space"),
        project=_first(parameters, "project"),
        since=_first(parameters, "since"),
        limit=commits.UNATTACHED_LIMIT if limit is None else limit,
    )


#: What the volumes read takes: its scope (`project_id` alone may be left out), its period,
#: and a filter of its tasks, each part of which may be repeated or left out.
_VOLUMES_SCOPE = ("scope_kind", "data_scope_id", "space_key", "project_id")
_VOLUMES_PERIOD = ("from", "to", "utc_offset")
_VOLUMES_FILTER = ("kind", "label")


def _volumes(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    """How much work stands in a scope and what came to a close in a period."""

    unknown = sorted(set(parameters) - {*_VOLUMES_SCOPE, *_VOLUMES_PERIOD, *_VOLUMES_FILTER})
    if unknown:
        raise PlanningHttpError(400, "invalid_request", f"{unknown[0]} is not a parameter")
    named = {name: _first(parameters, name) for name in _VOLUMES_SCOPE}
    scope = volumes.scope(
        conn,
        named["scope_kind"],
        data_scope_id=named["data_scope_id"],
        space_key=named["space_key"],
        project_id=named["project_id"],
    )
    offset = _required(parameters, "utc_offset")
    try:
        minutes = int(offset, 10)
    except ValueError as error:
        raise PlanningHttpError(
            400, "invalid_request", "utc_offset must be a whole number of minutes"
        ) from error
    period = volumes.period(_required(parameters, "from"), _required(parameters, "to"), minutes)
    kept = volumes.work_filter(conn, parameters.get("kind", []), parameters.get("label", []))
    return {
        "interface_version": PLANNING_API_INTERFACE,
        "volumes": volumes.read(conn, volumes.Request(scope, period, kept)),
    }


def _goal_volumes(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    """What each goal or stage named took, whole, in the order named."""

    return {
        "interface_version": PLANNING_API_INTERFACE,
        "goals": goal_volumes.read(conn, parameters.get("id", [])),
    }


#: The reads under `/api/planning/` that name their scope exactly, by `data_scope_id` and
#: `space_key`, and answer for the store this service writes. Every other read here
#: takes no data scope.
SCOPED_READS = frozenset({"/api/planning/volumes"})

#: The item's usage read, the one read that takes a reader of the quota.
_ITEM_USAGE = "/api/planning/work-item/usage"

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
    _ITEM_USAGE: _item_usage,
    "/api/planning/session/usage": _session_usage,
    "/api/planning/search": _search,
    "/api/planning/requests": _requests,
    "/api/planning/request": _request,
    "/api/planning/held": _held,
    "/api/planning/commits/unattached": _unattached,
    "/api/planning/volumes": _volumes,
    "/api/planning/goal-volumes": _goal_volumes,
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
    # A person's act on a goal or stage that nobody hears waits for the next
    # session, in the same transaction as the act (`waiting.after_person`), which
    # the end of the write's marks leaves before a container that stopped awaiting
    # its confirmation drops its words.
    before = waiting.place(conn) if calls.by_person() else None
    # One write, however many of the service's writes it takes: the goals and stages it
    # changed the work under come to await confirmation, or stop, once, at its end.
    with service.marking(conn, person=before) as entered:
        answer = writer(conn, payload)
        # Every write call has its row, including one that logged nothing — an edit,
        # a claim that found itself already held, a take-next with nothing to take.
        # Inside a bound call this finds the row a write already inserted; outside
        # one it does nothing. The person's words are left by that row.
        calls.call_id(conn, calls.acted_on(answer))
    if entered:
        answer["awaiting_confirmation"] = entered
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
        with service.one_write(conn):
            findings, applied = _run_steps(conn, base, steps)
        answer = service.get_work_item(conn, str(item["work_item_id"]))
    # What the creation itself said: the task a part was split off and the steps it took.
    said = {name: item[name] for name in _SPLIT_ANSWER if name in item}
    return {**answer, **said, **findings, "applied": applied}


#: What a creation that split a part off says beside the part.
_SPLIT_ANSWER = ("split_from", "moved_steps", "overridden")


def _created(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    if payload.get("split_from") is not None:
        return split.split_off(
            conn,
            _text(payload, "split_from"),
            steps=payload.get("steps"),
            title=_text(payload, "title"),
            kind=payload.get("kind"),
            priority=payload.get("priority"),
            description=payload.get("description"),
            labels=payload.get("labels"),
            source=payload.get("source"),
            projects=payload.get("projects"),
            set_by_source={name: payload.get(name) for name in ("parent", "state", "acceptance")},
            force=_flag(payload, "force"),
            author=_author(payload),
        )
    if payload.get("steps") is not None:
        raise model.PlanningError(
            f"[{split.SPLIT}] steps names the steps a part takes from split_from: send split_from"
            " with it"
        )
    return service.create_work_item(
        conn,
        space=_optional_text(payload, "space"),
        title=_text(payload, "title"),
        state=_optional_text(payload, "state"),
        kind=str(payload.get("kind") or "task"),
        priority=str(payload.get("priority") or "medium"),
        description=str(payload.get("description") or ""),
        labels=payload.get("labels"),
        source=str(payload.get("source") or ""),
        parent=_optional_text(payload, "parent"),
        author=_author(payload),
        acceptance=payload.get("acceptance"),
        projects=payload.get("projects"),
        # `_create` claims it in the same all-or-nothing change, before anything is kept.
        claimed=payload.get("claim") is True,
    )


def _update(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    """An edit, and the items its new description tells, which the one it replaced did not name.

    The answer is the whole item, whose `mentions` are the records of other texts
    naming it, so who hears the items this description named is `mentions_told`.
    """

    _refuse_retired_fields(payload)
    if payload.get("mentions") is None:
        return _edited(conn, payload)
    with _all_or_nothing(conn):
        source = read_model.item_row(conn, _text(payload, "id"))
        if _optional_text(payload, "description") is None and payload["mentions"] != []:
            raise model.PlanningError("mentions are told by a description: send it with them")
        named = mention_records.targets(
            conn, source, payload["mentions"], before=str(source["description"])
        )
        answer = _edited(conn, payload)
        where = mention_records.description_of(str(source["work_item_id"]))
        return _with_mentions(conn, answer, where, named, payload, key=TOLD)


def _edited(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    return service.update_work_item(
        conn,
        _text(payload, "id"),
        title=_optional_text(payload, "title"),
        description=(_optional_text(payload, "description")),
        source=_optional_text(payload, "source"),
        priority=(_optional_text(payload, "priority")),
        labels=payload.get("labels"),
        labels_add=payload.get("labels_add"),
        labels_remove=payload.get("labels_remove"),
        kind=_optional_text(payload, "kind"),
        parent=_optional_text(payload, "parent"),
        projects=payload.get("projects"),
        expected_revision=_optional_int(payload, "expected_revision"),
        author=_author(payload),
    )


def _delete(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    return service.delete_work_item(conn, _text(payload, "id"))


def _refuse_retired_fields(payload: Mapping[str, object]) -> None:
    """Refuse a write that names a field no input takes any more, before it writes."""

    says = model.retired_field(payload)
    if says is not None:
        raise PlanningHttpError(400, "invalid_request", says)


def _transition(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    """A move to a state; one into review or completed leaves the window the net looks
    behind once the write commits (`commits.closes`)."""

    _refuse_retired_fields(payload)
    reference, author = _text(payload, "id"), _author(payload)
    before = commits.before_transition(conn, reference)
    answer = service.transition_work_item(
        conn,
        reference,
        _text(payload, "state"),
        reason=str(payload.get("reason") or ""),
        force=_flag(payload, "force"),
        expected_revision=_optional_int(payload, "expected_revision"),
        author=author,
        acceptance=payload.get("acceptance"),
        to_check=payload.get("to_check"),
        cancels=payload.get("cancels"),
    )
    commits.after_transition(before, answer)
    return answer


def _defer(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    return service.defer_work_item(
        conn,
        _text(payload, "id"),
        until=payload.get("until"),
        reason=payload.get("reason"),
        force=_flag(payload, "force"),
        expected_revision=_optional_int(payload, "expected_revision"),
        author=_author(payload),
    )


def _move_out(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    return split.move_out(
        conn,
        _text(payload, "id"),
        reason=payload.get("reason"),
        force=_flag(payload, "force"),
        expected_revision=_optional_int(payload, "expected_revision"),
        author=_author(payload),
    )


def _convert(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    return split.convert(
        conn,
        _text(payload, "id"),
        to=payload.get("to"),
        leftover=payload.get("leftover"),
        force=_flag(payload, "force"),
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
        within=_optional_text(payload, "within"),
        label=_optional_text(payload, "label"),
        project=_optional_text(payload, "project"),
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


def _pin(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    """Pin an item for the person, or unpin it, and answer with the live-work frame."""

    pinned = _field(payload, "pinned")
    if not isinstance(pinned, bool):
        raise PlanningHttpError(400, "invalid_request", "pinned must be a boolean")
    service.pin_work_item(conn, _text(payload, "id"), pinned)
    return live_frame.frame(conn)


def _summary(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    """A summary, its list, and the items it tells that the summary it replaces did not name."""

    question = _list(payload)
    with _all_or_nothing(conn):
        named = _named(conn, payload, summary=True)
        answer = service.set_summary(
            conn,
            _text(payload, "id"),
            _field(payload, "summary"),
            expected_revision=_optional_int(payload, "expected_revision"),
            author=_author(payload),
        )
        comment_id = int(answer["summary_comment_id"])
        answer = _with_mentions(conn, answer, str(comment_id), named, payload, key=TOLD)
        return _with_list(conn, answer, comment_id, question, payload)


def _comment(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    """A comment, and in the same write the list it carries and the items it tells."""

    question = _list(payload)
    if question is not None and (
        payload.get("reply_to") is not None or payload.get("reply_to_request") is not None
    ):
        raise model.PlanningError("a list stands on a root, and this is a reply")
    with _all_or_nothing(conn):
        named = _named(conn, payload)
        written = service.comment_work_item(
            conn,
            _text(payload, "id"),
            _text(payload, "body"),
            author=_author(payload),
            checklist_item_id=_optional_text(payload, "checklist_item_id"),
            reply_to=_optional_int(payload, "reply_to"),
            reply_to_request=_optional_text(payload, "reply_to_request"),
            awaits_reply=_flag(payload, "awaits_reply"),
        )
        comment_id = int(written["comment_id"])
        written = _with_mentions(conn, written, str(comment_id), named, payload)
        return _with_list(conn, written, comment_id, question, payload)


def _list(payload: Mapping[str, object]) -> tuple[str, list[dict]] | None:
    """The list a comment, a report or a summary carries, checked before anything is written."""

    value = payload.get("list")
    return None if value is None else requests.list_question(value)


def _named(
    conn: sqlite3.Connection, payload: Mapping[str, object], *, summary: bool = False
) -> list[sqlite3.Row]:
    """The items a comment, a report or a summary tells in `mentions`, checked before writing.

    A `summary` replaces the item's summary, and leaves out what that one named.
    """

    if payload.get("mentions") is None:
        return []
    source = read_model.item_row(conn, _text(payload, "id"))
    before = mention_records.summary_text(source["summary"]) if summary else None
    return mention_records.targets(conn, source, payload["mentions"], before=before)


#: Where an answer that is the whole item says who hears the items its write named:
#: the item's own `mentions` are the records of other texts naming it.
TOLD = "mentions_told"


def _with_mentions(
    conn: sqlite3.Connection,
    answer: dict,
    where: str,
    named: list[sqlite3.Row],
    payload: Mapping[str, object],
    *,
    key: str = "mentions",
) -> dict:
    """The answer of a write, with who will hear each item its text named, under `key`."""

    if not named:
        return answer
    told = mention_records.record(conn, where, named, _author(payload))
    return {**answer, key: told}


def _with_list(
    conn: sqlite3.Connection,
    answer: dict,
    comment_id: int,
    question: tuple[str, list[dict]] | None,
    payload: Mapping[str, object],
) -> dict:
    """The answer of a write, with the list it put under its comment when it carried one."""

    if question is None:
        return answer
    identity = str(read_model.item_row(conn, _text(payload, "id"))["work_item_id"])
    request_id = requests.create_list(conn, identity, comment_id, question, _author(payload))
    return {**answer, "list_request_id": request_id}


def _comment_id(payload: Mapping[str, object]) -> int:
    comment_id = _field(payload, "comment_id")
    if not isinstance(comment_id, int) or isinstance(comment_id, bool):
        raise PlanningHttpError(400, "invalid_request", "comment_id must be an integer")
    return comment_id


def _resolve(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    return service.resolve_comment(
        conn,
        _text(payload, "id"),
        _comment_id(payload),
        resolution=_optional_text(payload, "resolution"),
        reopen=_flag(payload, "reopen"),
        author=_author(payload),
    )


def _request_fields(payload: Mapping[str, object], allowed: set[str]) -> None:
    if set(payload) - allowed:
        raise PlanningHttpError(400, "invalid_request", "request has unknown fields")


def _create_request(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    """A question to the owner, or with `addressees` one to each agent session named.

    A request asked of a session binds to no execution and no session of its item:
    those say whose work a question to the owner is about, and the session asked is
    named instead.
    """

    _request_fields(
        payload,
        {
            "id",
            "kind",
            "prompt",
            "fields",
            "author",
            "execution_id",
            "session_id",
            "expires_at",
            "addressees",
        },
    )
    if "addressees" in payload:
        if payload.get("execution_id") is not None or payload.get("session_id") is not None:
            raise model.PlanningError(
                "addressees asks agent sessions, and execution_id and session_id bind a"
                " question to the owner; send one or the other"
            )
        return requests.ask_from_agent(
            conn,
            _text(payload, "id"),
            addressees=payload["addressees"],
            kind=_field(payload, "kind"),
            prompt=_field(payload, "prompt"),
            fields=_field(payload, "fields"),
            expires_at=_optional_text(payload, "expires_at"),
            author=_author(payload),
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


#: What an answer and a change of one take.
_ANSWER_FIELDS = {"id", "answers", "own", "field_notes", "note", "expected_revision", "author"}


def _answer_request(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    _request_fields(payload, _ANSWER_FIELDS)
    return requests.resolve(
        conn,
        _text(payload, "id"),
        status="answered",
        expected_revision=_field(payload, "expected_revision"),
        answers=_field(payload, "answers"),
        own=payload.get("own"),
        field_notes=payload.get("field_notes"),
        note=payload.get("note"),
        author=_author(payload),
    )


def _change_request(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    _request_fields(payload, _ANSWER_FIELDS)
    return requests.change(
        conn,
        _text(payload, "id"),
        expected_revision=_field(payload, "expected_revision"),
        answers=_field(payload, "answers"),
        own=payload.get("own"),
        field_notes=payload.get("field_notes"),
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
    question = _list(payload)
    with _all_or_nothing(conn):
        named = _named(conn, payload, summary=_flag(payload, "make_current"))
        answer = service.report_work_item(
            conn,
            _text(payload, "id"),
            _field(payload, "report"),
            make_current=_flag(payload, "make_current"),
            expected_revision=_optional_int(payload, "expected_revision"),
            author=_author(payload),
        )
        # The report this call wrote is the item's newest comment.
        comment_id = int(answer["comments"][-1]["id"])
        answer = _with_mentions(conn, answer, str(comment_id), named, payload, key=TOLD)
        return _with_list(conn, answer, comment_id, question, payload)


def _select_summary(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    return service.select_summary(
        conn,
        _text(payload, "id"),
        _comment_id(payload),
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


def _commit(conn: sqlite3.Connection, payload: Mapping[str, object]) -> tuple[str, dict]:
    """One commit attached to the item by hand, or detached with `remove`: what it did."""

    reference, repository = _text(payload, "id"), _text(payload, "repository")
    hash_text = _text(payload, "hash")
    if _flag(payload, "remove"):
        return commits.detach(conn, reference, repository, hash_text, author=_author(payload))
    return commits.attach(
        conn,
        reference,
        repository,
        hash_text,
        label=_optional_text(payload, "label") or "",
        author=_author(payload),
    )


def _attach_commit(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    """A commit attached from the list of those on no card, or detached with `remove`.

    It is the `commits` group's entry, written by whoever calls: from the interface,
    the person. The answer names the commit as the item's record lists it, as it is
    attached now or, once detached, as it was (null for one a rewrite replaced, which
    the record does not list), and whether the write changed anything.
    """

    _request_fields(payload, {"reference", "repository", "hash", "remove"})
    reference = _text(payload, "reference")
    if not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")
    identity = str(read_model.item_row(conn, reference)["work_item_id"])
    before = read_model.commits(conn, identity)
    entry = {name: payload[name] for name in ("repository", "hash", "remove") if name in payload}
    outcome, pair = _commit(conn, {"id": reference, **entry})
    shown = next(
        (
            listed
            for listed in (*read_model.commits(conn, identity), *before)
            if (listed["repository"], listed["hash"]) == (pair["repository"], pair["hash"])
        ),
        None,
    )
    row = read_model.item_by_id(conn, identity)
    return {
        "reference": read_model.reference(conn, row),
        "revision": int(row["revision"]),
        "commit": shown,
        "changed": outcome != commits.UNCHANGED,
    }


def _space(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    created = service.create_planning_space(
        conn, name=_text(payload, "name"), key=_optional_text(payload, "key")
    )
    (shown,) = item_projects.spaces_shown(conn, [created])
    return shown


def _space_settings(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    """The owner's settings of one space, answered with the space record."""

    changed = service.set_launch_place(conn, _text(payload, "space"), payload.get("launch_place"))
    (shown,) = item_projects.spaces_shown(conn, [changed])
    return shown


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


_COMMENT_FIELDS = frozenset(
    {
        "body",
        "checklist_item_id",
        "reply_to",
        "reply_to_request",
        "list",
        "mentions",
        "awaits_reply",
    }
)
#: What a batch may change, in the order it applies them, with the fields each
#: entry may name. The order is the contract: a closing transition is judged
#: after the ticks and the summary sent beside it. `comment` is the one-entry
#: form `comments` replaced, kept for the schemas already in use; a batch names
#: one of the two. A question's entry takes what `create_work_item_request` does.
APPLY_GROUPS: tuple[tuple[str, frozenset[str]], ...] = (
    ("claim", frozenset()),
    ("subscribe", frozenset()),
    ("update", frozenset({*model.UPDATABLE_FIELDS, "mentions"})),
    ("convert", frozenset({"to", "leftover", "force"})),
    ("checklist", frozenset({"items", "force"})),
    ("checklist_ticks", frozenset({"item_id", "done", "force"})),
    ("refs", frozenset({"kind", "value", "label"})),
    ("commits", frozenset({"repository", "hash", "label", "remove"})),
    ("links", frozenset({"other", "kind", "remove"})),
    ("comment", _COMMENT_FIELDS),
    ("comments", _COMMENT_FIELDS),
    ("resolutions", frozenset({"comment_id", "resolution", "reopen"})),
    (
        "questions",
        frozenset(
            {
                "kind",
                "prompt",
                "fields",
                "execution_id",
                "session_id",
                "expires_at",
                "addressees",
            }
        ),
    ),
    ("summary", frozenset({"done", "next", "why", "friction", "list", "mentions"})),
    ("transition", frozenset({"state", "reason", "force", "acceptance", "to_check", "cancels"})),
    ("defer", frozenset({"until", "reason", "force"})),
    ("move_out", frozenset({"reason", "force"})),
)
#: The groups that each change the state: a batch names at most one of them. Converting
#: changes what the item is, and where it stands with it.
_STATE_CHANGES = ("convert", "transition", "defer", "move_out")
#: What a creation may do to the item it just made, after making it and in this
#: order. A link from a new item has nothing to remove, so `remove` is not taken.
CREATE_GROUPS: tuple[tuple[str, frozenset[str]], ...] = (
    ("claim", frozenset()),
    ("checklist", frozenset({"items"})),
    ("links", frozenset({"other", "kind"})),
)
#: The groups that are lists of entries rather than one object.
_APPLY_LISTS = frozenset(
    {"checklist_ticks", "refs", "commits", "links", "comments", "resolutions", "questions"}
)
#: The list groups whose answer says what each entry left rather than how many.
_APPLY_LISTED = frozenset({"checklist_ticks", "comments", "resolutions", "questions"})
#: The most entries one list in a batch may hold.
MAX_APPLY_ENTRIES = 100
#: What a batch says of each comment it wrote: the comment, the root a reply
#: joined, and the list it carries and who hears the items it named, when it did.
_COMMENT_ANSWER = ("comment_id", "reply_to", "reply_to_request", "list_request_id", "mentions")

_Step = tuple[str, int, Mapping[str, object]]


def _apply_entries(payload: Mapping[str, object]) -> list[_Step]:
    """Every step a batch names, in application order; a batch must name one."""

    if payload.get("comment") is not None and payload.get("comments") is not None:
        raise PlanningHttpError(
            400, "invalid_request", "comment and comments exclude each other; send comments"
        )
    changing = [group for group in _STATE_CHANGES if payload.get(group) is not None]
    if len(changing) > 1:
        raise PlanningHttpError(
            400,
            "invalid_request",
            f"{' and '.join(changing)} each change the state: send one, and the other in a"
            " call of its own",
        )
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
    is a boolean, so `false` names no step; `subscribe` is one whose `false` is a
    step of its own, stopping. A refused entry is named beside the
    message as a refused write is, so the caller reads one shape for both.
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
        if group == "subscribe":
            if not isinstance(value, bool):
                raise PlanningHttpError(400, "invalid_request", "subscribe must be a boolean")
            steps.append((group, 0, {"follows": value}))
            continue
        if group == "checklist" and isinstance(value, list):
            # The steps alone: the object form is needed only to carry `force`.
            value = {"items": value}
        entries = value if group in _APPLY_LISTS else [value]
        if not isinstance(entries, list) or len(entries) > MAX_APPLY_ENTRIES:
            raise PlanningHttpError(
                400,
                "invalid_request",
                f"{group} must be a list of at most {MAX_APPLY_ENTRIES} objects",
            )
        for index, entry in enumerate(entries):
            label = f"{group}[{index}]" if group in _APPLY_LISTS else group
            step = {"step": {"group": group, "index": index}}
            if not isinstance(entry, Mapping):
                raise PlanningHttpError(400, "invalid_request", f"{label} must be an object", step)
            unknown = sorted(set(entry) - fields)
            says = model.retired_field(unknown)
            if says is not None:
                raise PlanningHttpError(400, "invalid_request", f"{label}: {says}", step)
            if unknown:
                raise PlanningHttpError(
                    400,
                    "invalid_request",
                    f"{label}: unknown field(s) {', '.join(unknown)}; expected"
                    f" {', '.join(sorted(fields))}",
                    step,
                )
            steps.append((group, index, entry))
    return steps


def _forced_findings(answer: Mapping[str, object]) -> dict:
    """The override a step's single write recorded, which the batch's answer names as well."""

    return {"overridden": answer["overridden"]} if answer.get("overridden") else {}


def _apply_step(
    conn: sqlite3.Connection, group: str, base: Mapping[str, object], entry: Mapping[str, object]
) -> tuple[dict, object]:
    """Run one step through the write the single tool uses, and say what it changed."""

    if group == "claim":
        claimed = _claim(conn, base)
        return {name: claimed[name] for name in ("started", "warnings") if claimed.get(name)}, True
    if group == "subscribe":
        row = read_model.item_row(conn, _text(base, "id"))
        return {}, subscriptions.subscribe(conn, row, entry["follows"])
    if group == "update":
        # Who hears the items its description named stands where the single edit puts it.
        edited = _update(conn, {**entry, **base})
        return {name: edited[name] for name in (TOLD,) if name in edited}, model.updated_fields(
            entry
        )
    if group == "checklist":
        replaced = _checklist(conn, {**entry, **base})
        return _forced_findings(replaced), [
            {"item_id": step["id"], "text": step["text"], "done": step["done"]}
            for step in replaced["checklist"]
        ]
    if group == "checklist_ticks":
        ticked = _checklist_tick(conn, {**entry, **base})
        return _forced_findings(ticked), {
            "item_id": entry.get("item_id"),
            "done": entry.get("done", True),
        }
    if group == "refs":
        _ref(conn, {**entry, **base})
        return {}, 1
    if group == "commits":
        return {}, _commit(conn, {**entry, **base})
    if group == "links":
        _link(conn, {**entry, **base})
        return {}, 1
    if group in ("comment", "comments"):
        written = _comment(conn, {**entry, **base})
        # The root a reply joined, as the single tool's answer says it, and its list.
        return {}, {name: written[name] for name in _COMMENT_ANSWER if name in written}
    if group == "resolutions":
        marked = _resolve(conn, {**entry, **base})
        return {}, {name: marked[name] for name in ("comment_id", "resolution")}
    if group == "questions":
        asked = _create_request(conn, {**entry, **base})
        # An entry asked of sessions answers as the single write does: its requests,
        # each with its addressee.
        names = ("requests",) if "addressees" in entry else ("request_id", "revision")
        return {}, {name: asked[name] for name in names}
    if group == "summary":
        beside = {name: entry[name] for name in ("list", "mentions") if name in entry}
        summary = {name: value for name, value in entry.items() if name not in beside}
        answer = _summary(conn, {**base, **beside, "summary": summary})
        written = {
            name: answer[name]
            for name in ("summary_comment_id", "list_request_id")
            if name in answer
        }
        if TOLD in answer:
            written["mentions"] = answer[TOLD]
        return {}, written
    if group == "move_out":
        return _moved_out(conn, {**entry, **base})
    if group == "convert":
        return _converted(conn, {**entry, **base})
    if group == "defer":
        return _deferred(conn, {**entry, **base})
    answer = _transition(conn, {**entry, **base})
    found = {name: answer[name] for name in ("warnings", "overridden") if answer.get(name)}
    # An accepted open goal or stage stands in no state a caller names: it shows what it derives.
    moved = {"state": answer["state"]["key"] if answer["state"] is not None else None}
    if answer["container_state"] is not None:
        moved["container_state"] = answer["container_state"]
    # What the move closed and let go: the work a cancel took with it, the claims it
    # ended, the work it left with nothing open blocking it and the put-off work it
    # brought back.
    for name in ("cancelled", "released", "freed", "returned", "review_request_id"):
        if answer.get(name):
            moved[name] = answer[name]
    # Entering review or completing names the steps that are no longer as they were:
    # what the owner checks, or what the close stands for, is the steps as they are now.
    entered = None if answer["state"] is None else answer["state"]["category"]
    if entered in _NAMES_CHANGED_CONDITIONS and answer.get("conditions_changed"):
        moved["conditions_changed"] = answer["conditions_changed"]
    return found, moved


#: The states whose entry answers with `conditions_changed`, by category.
_NAMES_CHANGED_CONDITIONS = frozenset({"review", "completed"})


def _deferred(conn: sqlite3.Connection, payload: Mapping[str, object]) -> tuple[dict, object]:
    """A batch's put-off: where it went, whose claim it ended, and the condition."""

    answer = _defer(conn, payload)
    found = {name: answer[name] for name in ("warnings", "overridden") if answer.get(name)}
    moved: dict[str, object] = {"state": answer["state"]["key"], "deferred": answer["deferred"]}
    if answer.get("released"):
        moved["released"] = answer["released"]
    return found, moved


def _moved_out(conn: sqlite3.Connection, payload: Mapping[str, object]) -> tuple[dict, object]:
    """A batch's move out: where it went and whose claim it ended, and what it moved out of."""

    answer = _move_out(conn, payload)
    found = {
        name: answer[name] for name in ("warnings", "overridden", "moved_out") if answer.get(name)
    }
    moved: dict[str, object] = {"state": answer["state"]["key"]}
    if answer.get("released"):
        moved["released"] = answer["released"]
    return found, moved


def _converted(conn: sqlite3.Connection, payload: Mapping[str, object]) -> tuple[dict, object]:
    """A batch's conversion: what the item is now, where it stands, and whose claim it ended."""

    answer = _convert(conn, payload)
    found = {name: answer[name] for name in ("overridden", "converted") if answer.get(name)}
    moved: dict[str, object] = {
        "kind": answer["kind"],
        "state": answer["state"]["key"] if answer["state"] is not None else None,
    }
    if answer["container_state"] is not None:
        moved["container_state"] = answer["container_state"]
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

    The one refusal no single tool makes: a question, or a list on a comment,
    beside the transition that closes its item. The close ends every request still
    pending on the item in the same write, so the question would be asked and ended
    unanswered at once, and the list ended unticked. `force` does not carry it: no
    guard is being overridden.
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
        # One write: a task the batch leaves at work holds a holder at its end.
        with service.one_write(conn):
            findings, applied = _run_steps(conn, base, steps)
        answer = service.get_work_item(conn, reference)
        # A closed item takes no question or list, so one written here came before this close.
        if not answer["open"]:
            _refuse_unanswerable(applied)
    return {**answer, **findings, "applied": applied}


def _refuse_unanswerable(applied: Mapping[str, Any]) -> None:
    """Refuse a batch that closes its item over a question or a list it wrote itself.

    The close ended both in the same write: the question before anybody saw it, the
    list before anybody could tick it. The refusal leads to the write that passes,
    asking or listing in a call that leaves the item open.
    """

    step = {"step": {"group": "transition", "index": 0}}
    if "questions" in applied:
        raise PlanningHttpError(
            400,
            "invalid_request",
            "transition: a question on an item this call closes would end unanswered in"
            " the same write: ask it in a call that leaves the item open",
            step,
        )
    comments = applied.get("comments", [])
    written = [*comments, applied.get("comment", {}), applied.get("summary", {})]
    if any("list_request_id" in entry for entry in written):
        raise PlanningHttpError(
            400,
            "invalid_request",
            "transition: a list on an item this call closes would end unticked in the"
            " same write: write it in a call that leaves the item open",
            step,
        )


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
        # A claim's start and a transition may both warn, and a tick and a close may
        # both carry a force; no step's findings hide another's.
        joined = {
            name: [*findings.get(name, []), *extra.pop(name, [])]
            for name in ("warnings", "overridden")
        }
        findings.update(extra)
        findings.update({name: values for name, values in joined.items() if values})
        if group == "commits" and isinstance(change, tuple):
            applied[group] = commits.tally(applied.get(group), *change)
        elif group in _APPLY_LISTED:
            applied.setdefault(group, []).append(change)
        elif group in _APPLY_LISTS:
            applied[group] = applied.get(group, 0) + 1
        else:
            applied[group] = change
    return findings, applied


_WRITES: dict[str, Callable[[sqlite3.Connection, Mapping[str, object]], dict]] = {
    "/api/planning/spaces": _space,
    "/api/planning/space/settings": _space_settings,
    "/api/planning/work-items": _create,
    "/api/planning/work-item/update": _update,
    "/api/planning/work-item/delete": _delete,
    "/api/planning/work-item/transition": _transition,
    "/api/planning/work-item/defer": _defer,
    "/api/planning/work-item/move-out": _move_out,
    "/api/planning/work-item/convert": _convert,
    "/api/planning/work-item/claim": _claim,
    "/api/planning/work-item/claim-ready": _claim_ready,
    "/api/planning/work-item/checklist": _checklist,
    "/api/planning/work-item/checklist/claim": _checklist_claim,
    "/api/planning/work-item/checklist/tick": _checklist_tick,
    "/api/planning/work-item/link": _link,
    "/api/planning/work-item/merge": _merge,
    "/api/planning/work-item/pin": _pin,
    "/api/planning/work-item/summary": _summary,
    "/api/planning/work-item/comment": _comment,
    "/api/planning/work-item/comment/resolve": _resolve,
    "/api/planning/work-item/report": _report,
    "/api/planning/work-item/summary/select": _select_summary,
    "/api/planning/work-item/ref": _ref,
    "/api/planning/work-item/commit": _attach_commit,
    "/api/planning/work-item/apply": _apply,
    "/api/planning/work-item/request": _create_request,
    "/api/planning/request/answer": _answer_request,
    "/api/planning/request/change": _change_request,
    "/api/planning/request/decline": _decline_request,
    "/api/planning/request/expire": _expire_request,
}

READ_PATHS = tuple(sorted(_READS))
WRITE_PATHS = tuple(sorted(_WRITES))
