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

from . import acknowledgements, api, model, read_model, service

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
    "description": "Workflow state, by key or state_id, or by a category (backlog,"
    " queued, active, review, blocked, completed, cancelled) when exactly one state"
    " of the workflow has it. The states belong to the space's workflow; read them"
    " from get_planning_space. A name the workflow does not have is refused with"
    " its keys and categories.",
}
_EXPECTED_REVISION = {
    "type": "integer",
    "minimum": 0,
    "description": "Revision read from a previous read; rejects a stale write.",
}
_AUTHOR = {
    "type": "string",
    "description": "Your name for this call, recorded in the history. A claim or a"
    " checklist step is held by the session your client proved, whatever this"
    " says; author is the holder only for a call with no confirmed session.",
}
_FORCE = {
    "type": "boolean",
    "description": "Carry a refusal through. The override is recorded as an event.",
}
_RANK = {
    "type": "string",
    "description": "Where the item goes among the items of its state: first, last,"
    " before:MAIN-12 or after:MAIN-12, naming an item in that same state. The order"
    " is the one the board shows and claim_ready_work_item takes work in.",
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
    " Without it the answer holds at most limit rows (default"
    f" {COMPACT_LIMIT}).",
}
_OFFSET = {
    "type": "integer",
    "minimum": 0,
    "description": "How many items to skip, for the next page: pass the next_offset"
    " of the previous answer with the same filters.",
}
#: The most open members one page of get_work_item_chain carries.
CHAIN_PAGE = 200
#: How many of a chain's newest series entries get_work_item_chain carries.
CHAIN_SERIES_ENTRIES = 30
#: How much history get_work_item carries unless the caller asks for all of it.
RECENT_COMMENTS = 5
RECENT_EVENTS = 10
#: What every list and search says about paging, so an agent knows to keep going.
_PAGING = (
    " An answer holds one page: truncated is true when more items match, and"
    " next_offset is the offset to pass for the next page (null on the last one)."
    " Page until next_offset is null to read every match."
)


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
        " you name another. kind=epic is a parent; a hierarchy is one level deep."
        " claim and links act on the new item in the same call, all or nothing:"
        " it is created, then claimed, then linked, each as its single tool does."
        " A refused claim or link creates nothing and names the step and the"
        " refusal's code. With either, the answer adds applied, what each changed.",
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
            "claim": {
                "type": "boolean",
                "description": "true claims the new item as claim_work_item does,"
                " which starts it: it is created in its first state and then moved"
                " to the active one.",
            },
            "links": {
                "type": "array",
                "maxItems": api.MAX_APPLY_ENTRIES,
                "description": "Links from the new item, as link_work_items takes them:"
                " work found en route links discovered-from the item it was found from.",
                "items": {
                    "type": "object",
                    "properties": {
                        "other": _REFERENCE,
                        "kind": {"type": "string", "enum": sorted(model.LINK_KINDS)},
                    },
                    "required": ["other", "kind"],
                },
            },
            "author": _AUTHOR,
            "verbose": _VERBOSE,
        },
        ["space", "title"],
    ),
    _tool(
        "get_work_item",
        "Read a work item",
        "One item: its fields, checklist, links, refs and summary, the newest"
        f" {RECENT_COMMENTS} comments and {RECENT_EVENTS} history events with"
        " comments_total, events_total and history_truncated, and sessions: the"
        " agent sessions whose confirmed calls wrote to it. full=true returns every"
        " comment and event.",
        READ_ONLY,
        {
            "id": _REFERENCE,
            "full": {
                "type": "boolean",
                "description": "Answer with every comment and history event instead of"
                " the newest ones.",
            },
        },
        ["id"],
    ),
    _tool(
        "list_work_items",
        "List work items",
        "Items in state order, and inside a state in the planned order, filtered by state,"
        " category, kind, holder or parent. One compact row per item: reference, title,"
        " kind, state, priority, parent and holder."
        f" A page holds at most {service.MAX_LIST_PAGE} items." + _PAGING,
        READ_ONLY,
        {
            "space": _SPACE,
            "state": _STATE,
            "category": {"type": "string", "enum": list(model.STATE_CATEGORIES)},
            "kind": {"type": "string", "enum": sorted(model.WORK_ITEM_KINDS)},
            "owner": {
                "type": "string",
                "description": "Only items held by this holder, spelled exactly as"
                " claim_ref is: a confirmed session holds as 'codex (session <id>)',"
                " which a claim's acknowledgement returns.",
            },
            "parent": {
                "type": "string",
                "description": "Only the children of this item, by its reference (VAL-142)"
                " or its work_item_id.",
            },
            "limit": _INT,
            "offset": _OFFSET,
            "verbose": _VERBOSE_ROWS,
        },
    ),
    _tool(
        "get_work_item_chain",
        "Read a chain of work",
        "What one item's work grew into and whether it converges. scope=epic counts"
        " the item's children; scope=chain (the default) adds, transitively, every"
        " item discovered from it or from a member and every child of a member;"
        " relates-to, duplicates and blocks never widen it. Answers with total,"
        " closed, open, ready, by_category, origins (members grouped by parent),"
        f" the newest {CHAIN_SERIES_ENTRIES} entries of series (one per day with a"
        " change) and recent: the last 7 UTC"
        " days' created and closed and a trend of growing, converging or steady."
        " open_members lists the open members, active first, then review, then"
        " ready, then the rest, each in the order of work; a row's rank is its"
        " place in that order across the space, to compare, not to count; at most"
        f" {CHAIN_PAGE} per page." + _PAGING,
        READ_ONLY,
        {
            "id": _REFERENCE,
            "scope": {"type": "string", "enum": ["chain", "epic"]},
            "offset": _OFFSET,
            "limit": {
                "type": "integer",
                "description": f"Open members per page, {COMPACT_LIMIT} by default; a"
                f" larger limit is answered with at most {CHAIN_PAGE}.",
            },
        },
        ["id"],
    ),
    _tool(
        "search_work_items",
        "Search work items",
        "Match a phrase against titles, descriptions and closing summaries. A query that"
        " is exactly a reference, such as MAIN-12 in any case, answers that item first."
        " One compact row per item, with the matching comment line when that is what"
        " matched."
        f" A page holds at most {service.MAX_SEARCH_PAGE} items." + _PAGING,
        READ_ONLY,
        {
            "query": _STR,
            "space": _SPACE,
            "limit": _INT,
            "offset": _OFFSET,
            "verbose": _VERBOSE_ROWS,
        },
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
            "rank": _RANK,
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
        " stated reason. A cancelled state needs only the summary, saying why the"
        " work stopped; its undone steps stay open. force carries a refusal"
        " through and records it. The item goes last in its new state unless rank"
        " places it.",
        WRITES,
        {
            "id": _REFERENCE,
            "state": _STATE,
            "reason": {
                "type": "string",
                "description": "Why, when the state is blocked and no item blocks it.",
            },
            "force": _FORCE,
            "rank": _RANK,
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
        " force takes it over and records the takeover, release hands it back."
        " Claiming an item in a backlog or queued state starts it: it moves to the"
        " workflow's first active state it can reach, and the answer's started"
        " names both states. Review, blocked, active and finished items keep their"
        " state. Releasing an active item puts it back in the first queued state"
        " (or the backlog), named in requeued, unless one of its checklist steps is"
        " still claimed.",
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
        "Choose and claim in one step: the first unheld item in a startable state"
        " that nothing unfinished blocks, in the order of work — a queued state"
        " before the backlog, and inside a state the planned order (see rank on"
        " update_work_item); priority only breaks a tie. The claim starts the item"
        " as claim_work_item does, so it answers in its active state with started."
        " Answers with nothing when no item is ready.",
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
        "A structured pointer: a commit, an AgentMemory record id, or a url. Attach"
        " every memory record materially used for this work as kind=memory with"
        " its stable id; this is a one-way pointer and never writes back. Your own"
        " session needs no ref: Valkama records the confirmed session of every"
        " write itself. Raw logs and files do not belong here.",
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
        "apply_work_item_changes",
        "Apply several changes to a work item",
        "Several writes to one item in one call, all or nothing. Each group works"
        " exactly as its single tool does, and they apply in this order: claim,"
        " checklist_ticks, refs, links, comment, summary, transition — so a closing"
        " transition sees the ticks and the summary sent with it, and a transition"
        " sent with claim moves an item the claim has already started. A refused step"
        " writes nothing and names the step and the refusal's code. Name at least"
        " one group. Answers with the acknowledgement and applied, what each group"
        " changed.",
        WRITES,
        {
            "id": _REFERENCE,
            "claim": {
                "type": "boolean",
                "description": "true claims the item as claim_work_item does,"
                " starting it when it is in a backlog or queued state.",
            },
            "checklist_ticks": {
                "type": "array",
                "maxItems": api.MAX_APPLY_ENTRIES,
                "description": "Steps to complete, or to reopen with done=false.",
                "items": {
                    "type": "object",
                    "properties": {"item_id": _STR, "done": _BOOL},
                    "required": ["item_id"],
                },
            },
            "refs": {
                "type": "array",
                "maxItems": api.MAX_APPLY_ENTRIES,
                "description": "Pointers to attach, as attach_work_item_ref takes them.",
                "items": {
                    "type": "object",
                    "properties": {
                        "kind": {"type": "string", "enum": sorted(model.REF_KINDS)},
                        "value": _STR,
                        "label": _STR,
                    },
                    "required": ["kind", "value"],
                },
            },
            "links": {
                "type": "array",
                "maxItems": api.MAX_APPLY_ENTRIES,
                "description": "Links from this item, as link_work_items takes them.",
                "items": {
                    "type": "object",
                    "properties": {
                        "other": _REFERENCE,
                        "kind": {"type": "string", "enum": sorted(model.LINK_KINDS)},
                        "remove": _BOOL,
                    },
                    "required": ["other", "kind"],
                },
            },
            "comment": {
                "type": "object",
                "properties": {"body": _STR, "checklist_item_id": _STR},
                "required": ["body"],
            },
            "summary": {
                "type": "object",
                "properties": {"done": _STR, "next": _STR, "why": _STR},
                "required": ["done", "next"],
            },
            "transition": {
                "type": "object",
                "properties": {
                    "state": _STATE,
                    "reason": _STR,
                    "force": _FORCE,
                    "rank": _RANK,
                },
                "required": ["state"],
            },
            "expected_revision": {
                **_EXPECTED_REVISION,
                "description": "Revision read from a previous read; checked once, before"
                " the first step, and rejects a stale batch.",
            },
            "author": _AUTHOR,
            "verbose": _VERBOSE,
        },
        ["id"],
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


def _is_verbose(arguments: Mapping[str, object], name: str = "verbose") -> bool:
    verbose = arguments.get(name, False)
    if not isinstance(verbose, bool):
        raise api.PlanningHttpError(400, "invalid_request", f"{name} must be a boolean")
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


def _work_item(conn: sqlite3.Connection, arguments: Mapping[str, object]) -> object:
    """One item with its newest history unless the caller wants all of it.

    The cut is made by the boundary's opt-in parameters, so the HTTP read a
    screen makes without them is the complete record it always was. Either way
    the answer names the sessions that wrote to the item.
    """

    parameters = {"id": [str(arguments["id"])], "sessions": ["true"]}
    if not _is_verbose(arguments, "full"):
        parameters["comments"] = [str(RECENT_COMMENTS)]
        parameters["events"] = [str(RECENT_EVENTS)]
    answer = api.handle_get(conn, "/api/planning/work-item", parameters)
    if answer is None:  # pragma: no cover - the path table above is closed
        raise ValueError("no planning work item read")
    return answer[1]["work_item"]


def _search(conn: sqlite3.Connection, arguments: Mapping[str, object]) -> object:
    """`query` reads better than `q` in a tool call; the boundary keeps `q`."""

    parameters = {"q": [str(arguments["query"])]}
    for name in ("space", "limit", "offset"):
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
        "claim_state": item["claim_state"],
    }
    # Why a search returned the item; a row without it cannot be told from noise.
    return row | {name: item[name] for name in ("comment_hit", "summary_hit") if name in item}


def _listing(
    read: Callable[[sqlite3.Connection, Mapping[str, object]], object],
) -> Callable[[sqlite3.Connection, Mapping[str, object]], object]:
    """A read of many items, answered as rows unless the caller wants the items.

    The boundary answers every item with its checklist and labels, which is what
    a screen draws from and what floods a model that only wanted to find one
    reference. `verbose` returns that answer untouched. Otherwise the default
    limit is the compact one; either way the boundary's page says whether it was
    cut and where the next page starts.
    """

    def run(conn: sqlite3.Connection, arguments: Mapping[str, object]) -> object:
        verbose = _is_verbose(arguments)
        rest = {name: value for name, value in arguments.items() if name != "verbose"}
        if verbose:
            return read(conn, rest)
        if rest.get("limit") is None:
            rest["limit"] = COMPACT_LIMIT
        answer = read(conn, rest)
        if not isinstance(answer, dict):  # pragma: no cover - both reads answer a mapping
            return answer
        return {
            **answer,
            "work_items": [_compact_row(conn, item) for item in answer["work_items"]],
        }

    return run


def _open_rank(member: dict) -> int:
    """Where an open chain member is listed: work under way first, then work waiting
    on a reviewer, then work anyone could take now, then everything else."""

    category = member["state"]["category"]
    if category == "active":
        return 0
    if category == "review":
        return 1
    return 2 if member["ready"] else 3


def _count_argument(arguments: Mapping[str, object], name: str, default: int) -> int:
    value = arguments.get(name)
    return default if value is None else model.count_field(value, name)


def _chain(conn: sqlite3.Connection, arguments: Mapping[str, object]) -> object:
    """The chain as the HTTP read answers it, without the parts a model need not scan.

    The members and edges a screen draws are left out; the open members come as
    compact rows, one page at a time, and the series keeps its newest days.
    """

    offset = _count_argument(arguments, "offset", 0)
    size = max(1, min(_count_argument(arguments, "limit", COMPACT_LIMIT), CHAIN_PAGE))
    parameters = {"id": [str(arguments["id"])]}
    if arguments.get("scope") is not None:
        parameters["scope"] = [str(arguments["scope"])]
    answer = api.handle_get(conn, "/api/planning/work-item/chain", parameters)
    if answer is None:  # pragma: no cover - the path table above is closed
        raise ValueError("no planning chain read")
    found = dict(answer[1]["chain"])
    members = found.pop("members")
    found.pop("edges")
    found["series"] = found["series"][-CHAIN_SERIES_ENTRIES:]
    open_members = sorted(
        (member for member in members if not member["state"]["is_terminal"]),
        key=lambda member: (_open_rank(member), member["rank"]),
    )
    found["open_members"] = [
        {
            "reference": member["reference"],
            "title": member["title"],
            "state": member["state"]["key"],
            "claim_ref": member["claim_ref"],
            "ready": member["ready"],
            "parent_reference": member["parent_reference"],
            "rank": member["rank"],
        }
        for member in open_members[offset : offset + size]
    ]
    truncated = len(open_members) > offset + size
    found["truncated"] = truncated
    found["next_offset"] = offset + size if truncated else None
    return found


def _space(conn: sqlite3.Connection, arguments: Mapping[str, object]) -> object:
    return service.get_planning_space(conn, str(arguments["space"]))


OPS: dict[str, Callable[[sqlite3.Connection, Mapping[str, object]], object]] = {
    "list_planning_spaces": _get("/api/planning/spaces"),
    "get_planning_space": _space,
    "create_planning_space": _post("/api/planning/spaces"),
    "create_work_item": _acknowledged("/api/planning/work-items", acknowledgements.created),
    "get_work_item": _work_item,
    "list_work_items": _listing(
        _get(
            "/api/planning/work-items",
            "space",
            "state",
            "category",
            "kind",
            "owner",
            "parent",
            "limit",
            "offset",
        )
    ),
    "get_work_item_chain": _chain,
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
    "apply_work_item_changes": _acknowledged(
        "/api/planning/work-item/apply", acknowledgements.applied
    ),
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
