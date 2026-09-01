"""The agent-facing vocabulary of Planning: one tool per neutral operation.

Every tool is named for what it acts on — a WorkItem, a PlanningSpace — and
every one of them delegates to the same boundary the HTTP surface uses, so a
rule cannot hold in one and not the other. The Board era wrote the same
decisions twice and they drifted.

Declarative on purpose: the definitions are data and the handlers are one call
each. The MCP surface decides *which* catalogue to publish; nothing here knows
that a catalogue can change.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable, Mapping

from . import api, model

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
        "Items in state order, filtered by state, category, kind or holder.",
        READ_ONLY,
        {
            "space": _SPACE,
            "state": _STATE,
            "category": {"type": "string", "enum": list(model.STATE_CATEGORIES)},
            "kind": {"type": "string", "enum": sorted(model.WORK_ITEM_KINDS)},
            "owner": _STR,
            "limit": _INT,
        },
    ),
    _tool(
        "search_work_items",
        "Search work items",
        "Match a phrase against titles, descriptions and closing summaries.",
        READ_ONLY,
        {"query": _STR, "space": _SPACE, "limit": _INT},
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
        },
        ["id", "summary"],
    ),
    _tool(
        "comment_work_item",
        "Comment on a work item",
        "A note on the record, for anything the fields have no place for.",
        WRITES,
        {"id": _REFERENCE, "body": _STR, "author": _AUTHOR},
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

TOOL_NAMES = frozenset(tool["name"] for tool in TOOLS)


def _post(path: str) -> Callable[[sqlite3.Connection, Mapping[str, object]], object]:
    def run(conn: sqlite3.Connection, arguments: Mapping[str, object]) -> object:
        answer = api.handle_post(conn, path, arguments)
        if answer is None:  # pragma: no cover - the path table above is closed
            raise ValueError(f"no planning write at {path}")
        return answer[1]

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


def _space(conn: sqlite3.Connection, arguments: Mapping[str, object]) -> object:
    from . import service

    return service.get_planning_space(conn, str(arguments["space"]))


OPS: dict[str, Callable[[sqlite3.Connection, Mapping[str, object]], object]] = {
    "list_planning_spaces": _get("/api/planning/spaces"),
    "get_planning_space": _space,
    "create_planning_space": _post("/api/planning/spaces"),
    "create_work_item": _post("/api/planning/work-items"),
    "get_work_item": _get("/api/planning/work-item", "id", unwrap="work_item"),
    "list_work_items": _get(
        "/api/planning/work-items", "space", "state", "category", "kind", "owner", "limit"
    ),
    "search_work_items": _search,
    "update_work_item": _post("/api/planning/work-item/update"),
    "transition_work_item": _post("/api/planning/work-item/transition"),
    "claim_work_item": _post("/api/planning/work-item/claim"),
    "claim_ready_work_item": _post("/api/planning/work-item/claim-ready"),
    "set_work_item_checklist": _post("/api/planning/work-item/checklist"),
    "claim_work_item_checklist_item": _post("/api/planning/work-item/checklist/claim"),
    "tick_work_item_checklist_item": _post("/api/planning/work-item/checklist/tick"),
    "link_work_items": _post("/api/planning/work-item/link"),
    "attach_work_item_ref": _post("/api/planning/work-item/ref"),
    "set_work_item_summary": _post("/api/planning/work-item/summary"),
    "comment_work_item": _post("/api/planning/work-item/comment"),
    "delete_work_item": _post("/api/planning/work-item/delete"),
}
