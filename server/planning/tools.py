"""The agent-facing vocabulary of Planning: one tool per neutral operation.

Every tool is named for what it acts on — a WorkItem, a PlanningSpace — and
every one of them delegates to the same boundary the HTTP surface uses, so a
rule cannot hold in one and not the other. The Board era wrote the same
decisions twice and they drifted.

Declarative on purpose: the definitions are data and the handlers are one call
each. A write to a work item narrows its answer to an acknowledgement unless the
caller passes `verbose`, and a list or a search narrows each item to one row; the
boundary underneath still answers in full. The MCP surface decides *which*
catalogue to publish; nothing here knows that a catalogue can change.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable, Mapping

from . import acknowledgements, api, model, read_model

READ_ONLY = {"readOnlyHint": True, "idempotentHint": True, "openWorldHint": False}
WRITES = {"readOnlyHint": False, "destructiveHint": False, "openWorldHint": False}
DESTRUCTIVE = {"readOnlyHint": False, "destructiveHint": True, "openWorldHint": False}

_STR = {"type": "string"}
_INT = {"type": "integer"}
_BOOL = {"type": "boolean"}
_LABELS = {"type": "array", "items": {"type": "string"}}
_REFERENCE = {
    "type": "string",
    "description": "A work item, by its reference (VAL-142) or its work_item_id.",
}
_SPACE = {
    "type": "string",
    "description": "Planning space, by key (VAL), name, or planning_space_id.",
}
_STATE = {
    "type": "string",
    "description": "Workflow state, by key or state_id. The states belong to the"
    " space's workflow; read them from get_planning_space.",
}
_EXPECTED_REVISION = {
    "type": "integer",
    "minimum": 0,
    "description": "Revision read from a previous read; rejects a stale write.",
}
_AUTHOR = {"type": "string", "description": "Who is acting. Recorded, not resolved."}
_FORCE = {
    "type": "boolean",
    "description": "Carry a refusal through. The override is recorded as an event.",
}
_VERBOSE = {
    "type": "boolean",
    "description": "Answer with the full work item instead of the short acknowledgement.",
}
#: Rows a list or a search answers with when the caller names no limit.
COMPACT_LIMIT = 50
_VERBOSE_ROWS = {
    "type": "boolean",
    "description": "Answer with the full items instead of one compact row per item."
    " Without it the answer is capped at limit rows (default"
    f" {COMPACT_LIMIT}) and says whether it was cut.",
}


def _tool(
    name: str,
    title: str,
    description: str,
    annotations: dict,
    properties: dict,
    required: list[str] | None = None,
) -> dict:
    return {
        "name": name,
        "title": title,
        "annotations": dict(annotations, title=title),
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": properties,
            **({"required": required} if required else {}),
        },
    }


TOOLS = [
    _tool(
        "list_planning_spaces",
        "List planning spaces",
        "Every planning space with its key, its project, and how much work it holds.",
        READ_ONLY,
        {},
    ),
    _tool(
        "get_planning_space",
        "Read a planning space",
        "One space and its workflow: the states, their categories, and the"
        " transitions between them. Read this before asking for a state by name.",
        READ_ONLY,
        {"space": _SPACE},
        ["space"],
    ),
    _tool(
        "create_planning_space",
        "Create a planning space",
        "A new space in one project, with the default workflow. Its key is derived"
        " from the name unless you name one.",
        WRITES,
        {"project_id": _STR, "name": _STR, "key": _STR},
        ["project_id", "name"],
    ),
    _tool(
        "create_work_item",
        "Create a work item",
        "One unit of planned work. It starts in the workflow's initial state unless"
        " you name another. kind=epic is a parent; a hierarchy is one level deep.",
        WRITES,
        {
            "space": _SPACE,
            "title": _STR,
            "state": _STATE,
            "kind": {"type": "string", "enum": sorted(model.WORK_ITEM_KINDS)},
            "priority": {"type": "string", "enum": list(model.PRIORITIES)},
            "description": _STR,
            "labels": _LABELS,
            "source": {
                "type": "string",
                "description": "Anchor into the owning document, e.g."
                " docs/plan.md#kb:a7f3. Point at the immutable <!-- kb:xxxx -->"
                " comment; never copy the plan text into the item.",
            },
            "parent": _REFERENCE,
            "author": _AUTHOR,
            "verbose": _VERBOSE,
        },
        ["space", "title"],
    ),
    _tool(
        "get_work_item",
        "Read a work item",
        "One item in full: its state, checklist, links, refs, comments and event trail.",
        READ_ONLY,
        {"id": _REFERENCE},
        ["id"],
    ),
    _tool(
        "list_work_items",
        "List work items",
        "Items in state order, filtered by state, category, kind or holder. One compact"
        " row per item: reference, title, kind, state, priority, parent and holder.",
        READ_ONLY,
        {
            "space": _SPACE,
            "state": _STATE,
            "category": {"type": "string", "enum": list(model.STATE_CATEGORIES)},
            "kind": {"type": "string", "enum": sorted(model.WORK_ITEM_KINDS)},
            "owner": _STR,
            "limit": _INT,
            "verbose": _VERBOSE_ROWS,
        },
    ),
    _tool(
        "search_work_items",
        "Search work items",
        "Match a phrase against titles, descriptions and closing summaries. One compact"
        " row per item, with the matching comment line when that is what matched.",
        READ_ONLY,
        {"query": _STR, "space": _SPACE, "limit": _INT, "verbose": _VERBOSE_ROWS},
        ["query"],
    ),
    _tool(
        "update_work_item",
        "Edit a work item",
        "Change the fields a state transition does not own. Pass expected_revision"
        " to refuse a stale write.",
        WRITES,
        {
            "id": _REFERENCE,
            "title": _STR,
            "description": _STR,
            "source": {
                "type": "string",
                "description": "Anchor into the owning document, e.g."
                " docs/plan.md#kb:a7f3. Update the existing marker without"
                " changing the item's identity or copying plan text into it.",
            },
            "priority": {"type": "string", "enum": list(model.PRIORITIES)},
            "labels": _LABELS,
            "kind": {"type": "string", "enum": sorted(model.WORK_ITEM_KINDS)},
            "parent": _REFERENCE,
            "expected_revision": _EXPECTED_REVISION,
            "author": _AUTHOR,
            "verbose": _VERBOSE,
        },
        ["id"],
    ),
    _tool(
        "transition_work_item",
        "Move a work item to a state",
        "The one path a state changes by. The workflow's guards apply: an active"
        " state needs an executor, a terminal state needs every checklist step"
        " ticked and a closing summary, a blocked state needs a blocker or a"
        " stated reason. force carries a refusal through and records it.",
        WRITES,
        {
            "id": _REFERENCE,
            "state": _STATE,
            "reason": {
                "type": "string",
                "description": "Why, when the state is blocked and no item blocks it.",
            },
            "force": _FORCE,
            "expected_revision": _EXPECTED_REVISION,
            "author": _AUTHOR,
            "verbose": _VERBOSE,
        },
        ["id", "state"],
    ),
    _tool(
        "claim_work_item",
        "Claim a work item",
        "Take ownership before working it. Refuses if somebody else holds it;"
        " force takes it over and records the takeover, release hands it back.",
        WRITES,
        {
            "id": _REFERENCE,
            "author": _AUTHOR,
            "force": _FORCE,
            "release": _BOOL,
            "expected_revision": _EXPECTED_REVISION,
            "verbose": _VERBOSE,
        },
        ["id"],
    ),
    _tool(
        "claim_ready_work_item",
        "Claim the next ready work item",
        "Choose and claim in one step: the highest-priority unheld item in a"
        " startable state that nothing unfinished blocks. Answers with nothing"
        " when no item is ready.",
        WRITES,
        {"space": _SPACE, "author": _AUTHOR},
    ),
    _tool(
        "set_work_item_checklist",
        "Set a work item's checklist",
        "Replace the steps. Existing claimed or completed state is protected;"
        " force discards it explicitly.",
        WRITES,
        {
            "id": _REFERENCE,
            "items": {"type": "array", "items": {"type": "string"}},
            "force": _FORCE,
            "expected_revision": _EXPECTED_REVISION,
            "author": _AUTHOR,
            "verbose": _VERBOSE,
        },
        ["id", "items"],
    ),
    _tool(
        "claim_work_item_checklist_item",
        "Claim one checklist step",
        "Take one step so two agents can split an item without either inventing"
        " a percentage. Refuses another holder's step unless force.",
        WRITES,
        {
            "id": _REFERENCE,
            "item_id": _STR,
            "author": _AUTHOR,
            "force": _FORCE,
            "release": _BOOL,
            "expected_revision": _EXPECTED_REVISION,
            "verbose": _VERBOSE,
        },
        ["id", "item_id"],
    ),
    _tool(
        "tick_work_item_checklist_item",
        "Complete one checklist step",
        "Mark one step done, or reopen it with done=false. Completion records who"
        " and clears the live claim.",
        WRITES,
        {
            "id": _REFERENCE,
            "item_id": _STR,
            "done": _BOOL,
            "author": _AUTHOR,
            "force": _FORCE,
            "expected_revision": _EXPECTED_REVISION,
            "verbose": _VERBOSE,
        },
        ["id", "item_id"],
    ),
    _tool(
        "link_work_items",
        "Relate two work items",
        "blocks carries readiness; relates-to, discovered-from and duplicates"
        " carry meaning. remove=true takes the link away.",
        WRITES,
        {
            "id": _REFERENCE,
            "other": _REFERENCE,
            "kind": {"type": "string", "enum": sorted(model.LINK_KINDS)},
            "remove": _BOOL,
            "author": _AUTHOR,
        },
        ["id", "other", "kind"],
    ),
    _tool(
        "attach_work_item_ref",
        "Attach a reference",
        "A structured pointer: a commit, a session id, an AgentMemory record id,"
        " or a url. Attach every memory record materially used for this work as"
        " kind=memory with its stable id; this is a one-way pointer and never"
        " writes back. Raw logs and files do not belong here.",
        WRITES,
        {
            "id": _REFERENCE,
            "kind": {"type": "string", "enum": sorted(model.REF_KINDS)},
            "value": _STR,
            "label": _STR,
            "author": _AUTHOR,
        },
        ["id", "kind", "value"],
    ),
    _tool(
        "set_work_item_summary",
        "Record a closing summary",
        "What was done, what comes next, and why only when the choice is not"
        " obvious. A terminal state needs this; it is what the next agent reads"
        " instead of re-deriving the work.",
        WRITES,
        {
            "id": _REFERENCE,
            "summary": {
                "type": "object",
                "properties": {"done": _STR, "next": _STR, "why": _STR},
                "required": ["done", "next"],
            },
            "expected_revision": _EXPECTED_REVISION,
            "author": _AUTHOR,
            "verbose": _VERBOSE,
        },
        ["id", "summary"],
    ),
    _tool(
        "report_work_item",
        "Publish a work report",
        "Add an immutable report to the discussion. make_current selects it as"
        " the current outcome atomically and requires expected_revision.",
        WRITES,
        {
            "id": _REFERENCE,
            "report": {
                "type": "object",
                "properties": {"done": _STR, "next": _STR, "why": _STR},
                "required": ["done", "next"],
            },
            "make_current": _BOOL,
            "expected_revision": _EXPECTED_REVISION,
            "author": _AUTHOR,
            "verbose": _VERBOSE,
        },
        ["id", "report"],
    ),
    _tool(
        "select_work_item_summary",
        "Use a report as the current outcome",
        "Select an existing report belonging to this work item without retyping it.",
        WRITES,
        {
            "id": _REFERENCE,
            "comment_id": {"type": "integer", "minimum": 1},
            "expected_revision": _EXPECTED_REVISION,
            "author": _AUTHOR,
            "verbose": _VERBOSE,
        },
        ["id", "comment_id", "expected_revision"],
    ),
    _tool(
        "comment_work_item",
        "Comment on a work item",
        "A note on the record, for anything the fields have no place for.",
        WRITES,
        {"id": _REFERENCE, "body": _STR, "author": _AUTHOR, "checklist_item_id": _STR},
        ["id", "body"],
    ),
    _tool(
        "delete_work_item",
        "Delete a work item",
        "Removes the item and its trail. Refuses while it still has children.",
        DESTRUCTIVE,
        {"id": _REFERENCE},
        ["id"],
    ),
]

_REQUEST_FIELD = {
    "type": "object",
    "properties": {
        "id": _STR,
        "label": _STR,
        "type": {"type": "string", "enum": ["text", "choice", "multi_choice", "boolean"]},
        "required": _BOOL,
        "options": {
            "type": "array",
            "maxItems": 20,
            "items": {
                "type": "object",
                "properties": {"id": _STR, "label": _STR},
                "required": ["id", "label"],
            },
        },
    },
    "required": ["id", "label", "type", "required", "options"],
}
TOOLS.extend(
    [
        _tool(
            "create_work_item_request",
            "Ask for a human answer",
            "Create a typed question or decision on an item. Does not change workflow or execution lifecycle.",
            WRITES,
            {
                "id": _REFERENCE,
                "kind": {"type": "string", "enum": ["question", "decision"]},
                "prompt": _STR,
                "fields": {"type": "array", "minItems": 1, "maxItems": 12, "items": _REQUEST_FIELD},
                "author": _AUTHOR,
                "execution_id": _STR,
                "session_id": _STR,
                "expires_at": _STR,
            },
            ["id", "kind", "prompt", "fields"],
        ),
        _tool(
            "get_work_item_request",
            "Read a human request",
            "Read an exact request including effective expiry.",
            READ_ONLY,
            {"id": _STR},
            ["id"],
        ),
        _tool(
            "list_work_item_requests",
            "List human requests",
            "List requests in the primary store, optionally narrowed to a space and effective status.",
            READ_ONLY,
            {
                "space": _SPACE,
                "status": {
                    "type": "string",
                    "enum": ["pending", "answered", "declined", "expired"],
                },
                "limit": _INT,
            },
        ),
        _tool(
            "answer_work_item_request",
            "Answer a human request",
            "Answer once using the request revision. Does not resume an execution.",
            WRITES,
            {
                "id": _STR,
                "answers": {"type": "object"},
                "expected_revision": _EXPECTED_REVISION,
                "author": _AUTHOR,
            },
            ["id", "answers", "expected_revision"],
        ),
        _tool(
            "decline_work_item_request",
            "Decline a human request",
            "Decline a pending request using its revision.",
            WRITES,
            {"id": _STR, "expected_revision": _EXPECTED_REVISION, "author": _AUTHOR},
            ["id", "expected_revision"],
        ),
        _tool(
            "expire_work_item_request",
            "Withdraw a human request",
            "Explicitly withdraw a pending request, retaining its record.",
            WRITES,
            {"id": _STR, "expected_revision": _EXPECTED_REVISION, "author": _AUTHOR},
            ["id", "expected_revision"],
        ),
    ]
)

TOOL_NAMES = frozenset(tool["name"] for tool in TOOLS)


def _post(path: str) -> Callable[[sqlite3.Connection, Mapping[str, object]], object]:
    def run(conn: sqlite3.Connection, arguments: Mapping[str, object]) -> object:
        answer = api.handle_post(conn, path, arguments)
        if answer is None:  # pragma: no cover - the path table above is closed
            raise ValueError(f"no planning write at {path}")
        return answer[1]

    return run


def _is_verbose(arguments: Mapping[str, object]) -> bool:
    verbose = arguments.get("verbose", False)
    if not isinstance(verbose, bool):
        raise api.PlanningHttpError(400, "invalid_request", "verbose must be a boolean")
    return verbose


def _acknowledged(
    path: str, acknowledge: acknowledgements.Acknowledge
) -> Callable[[sqlite3.Connection, Mapping[str, object]], object]:
    """A write that answers briefly unless the caller asks for the whole item.

    The full record is what the HTTP boundary returns and what `verbose` still
    returns here; the short form is cut from it afterwards, so the write itself
    is the same either way.
    """

    write = _post(path)

    def run(conn: sqlite3.Connection, arguments: Mapping[str, object]) -> object:
        verbose = _is_verbose(arguments)
        item = write(conn, {name: value for name, value in arguments.items() if name != "verbose"})
        if verbose or not isinstance(item, dict):
            return item
        return acknowledge(item, arguments)

    return run


def _get(
    path: str, *names: str, unwrap: str | None = None
) -> Callable[[sqlite3.Connection, Mapping[str, object]], object]:
    """Turn named arguments into query parameters, and answer with the thing asked for.

    A read that names one entity returns that entity rather than an envelope
    around it, so a tool answer reads the same whether it came from a read or
    from the write that produced it.
    """

    def run(conn: sqlite3.Connection, arguments: Mapping[str, object]) -> object:
        parameters = {
            name: [str(arguments[name])]
            for name in names
            if name in arguments and arguments[name] is not None
        }
        answer = api.handle_get(conn, path, parameters)
        if answer is None:  # pragma: no cover - the path table above is closed
            raise ValueError(f"no planning read at {path}")
        return answer[1][unwrap] if unwrap else answer[1]

    return run


def _search(conn: sqlite3.Connection, arguments: Mapping[str, object]) -> object:
    """`query` reads better than `q` in a tool call; the boundary keeps `q`."""

    parameters = {"q": [str(arguments["query"])]}
    for name in ("space", "limit"):
        if arguments.get(name) is not None:
            parameters[name] = [str(arguments[name])]
    answer = api.handle_get(conn, "/api/planning/search", parameters)
    if answer is None:  # pragma: no cover - the path table above is closed
        raise ValueError("no planning search boundary")
    return answer[1]


def _compact_row(conn: sqlite3.Connection, item: dict) -> dict:
    """One item as a row: what a caller scans a list for, and nothing it must open."""

    parent = item["parent_id"]
    row = {
        "reference": item["reference"],
        "title": item["title"],
        "kind": item["kind"],
        "state": item["state"]["key"],
        "priority": item["priority"],
        "parent": read_model.reference(conn, read_model.item_by_id(conn, parent))
        if parent
        else None,
        "claim_ref": item["claim_ref"],
    }
    # Why a search returned the item; a row without it cannot be told from noise.
    return row | {name: item[name] for name in ("comment_hit", "summary_hit") if name in item}


def _listing(
    read: Callable[[sqlite3.Connection, Mapping[str, object]], object],
) -> Callable[[sqlite3.Connection, Mapping[str, object]], object]:
    """A read of many items, answered as rows unless the caller wants the items.

    The boundary answers every item with its checklist and labels, which is what
    a screen draws from and what floods a model that only wanted to find one
    reference. `verbose` returns that answer untouched. Otherwise the call is
    bounded: one row more than the limit is read, so the answer can say it was
    cut instead of passing for the whole.
    """

    def run(conn: sqlite3.Connection, arguments: Mapping[str, object]) -> object:
        verbose = _is_verbose(arguments)
        rest = {name: value for name, value in arguments.items() if name != "verbose"}
        if verbose:
            return read(conn, rest)
        raw = rest.get("limit")
        try:
            limit = COMPACT_LIMIT if raw is None else max(1, int(str(raw), 10))
        except ValueError as error:
            raise api.PlanningHttpError(
                400, "invalid_request", "limit must be an integer"
            ) from error
        answer = read(conn, {**rest, "limit": limit + 1})
        if not isinstance(answer, dict):  # pragma: no cover - both reads answer a mapping
            return answer
        items = answer["work_items"]
        return {
            **answer,
            "work_items": [_compact_row(conn, item) for item in items[:limit]],
            "truncated": len(items) > limit,
        }

    return run


def _space(conn: sqlite3.Connection, arguments: Mapping[str, object]) -> object:
    from . import service

    return service.get_planning_space(conn, str(arguments["space"]))


OPS: dict[str, Callable[[sqlite3.Connection, Mapping[str, object]], object]] = {
    "list_planning_spaces": _get("/api/planning/spaces"),
    "get_planning_space": _space,
    "create_planning_space": _post("/api/planning/spaces"),
    "create_work_item": _acknowledged("/api/planning/work-items", acknowledgements.created),
    "get_work_item": _get("/api/planning/work-item", "id", unwrap="work_item"),
    "list_work_items": _listing(
        _get("/api/planning/work-items", "space", "state", "category", "kind", "owner", "limit")
    ),
    "search_work_items": _listing(_search),
    "update_work_item": _acknowledged("/api/planning/work-item/update", acknowledgements.updated),
    "transition_work_item": _acknowledged(
        "/api/planning/work-item/transition", acknowledgements.transitioned
    ),
    "claim_work_item": _acknowledged("/api/planning/work-item/claim", acknowledgements.claimed),
    "claim_ready_work_item": _post("/api/planning/work-item/claim-ready"),
    "set_work_item_checklist": _acknowledged(
        "/api/planning/work-item/checklist", acknowledgements.checklist_replaced
    ),
    "claim_work_item_checklist_item": _acknowledged(
        "/api/planning/work-item/checklist/claim", acknowledgements.step_changed
    ),
    "tick_work_item_checklist_item": _acknowledged(
        "/api/planning/work-item/checklist/tick", acknowledgements.step_changed
    ),
    "link_work_items": _post("/api/planning/work-item/link"),
    "attach_work_item_ref": _post("/api/planning/work-item/ref"),
    "set_work_item_summary": _acknowledged(
        "/api/planning/work-item/summary", acknowledgements.summarized
    ),
    "comment_work_item": _post("/api/planning/work-item/comment"),
    "report_work_item": _acknowledged("/api/planning/work-item/report", acknowledgements.reported),
    "select_work_item_summary": _acknowledged(
        "/api/planning/work-item/summary/select", acknowledgements.summarized
    ),
    "delete_work_item": _post("/api/planning/work-item/delete"),
    "create_work_item_request": _post("/api/planning/work-item/request"),
    "get_work_item_request": _get("/api/planning/request", "id", unwrap="request"),
    "list_work_item_requests": _get("/api/planning/requests", "space", "status", "limit"),
    "answer_work_item_request": _post("/api/planning/request/answer"),
    "decline_work_item_request": _post("/api/planning/request/decline"),
    "expire_work_item_request": _post("/api/planning/request/expire"),
}
