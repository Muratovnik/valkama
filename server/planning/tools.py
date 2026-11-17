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

from . import (
    acknowledgements,
    api,
    calls,
    images,
    item_projects,
    mention_records,
    model,
    person_events,
    read_model,
    request_model,
    requests,
    service,
    waiting,
    words,
)

READ_ONLY = {"readOnlyHint": True, "idempotentHint": True, "openWorldHint": False}
WRITES = {"readOnlyHint": False, "destructiveHint": False, "openWorldHint": False}
DESTRUCTIVE = {"readOnlyHint": False, "destructiveHint": True, "openWorldHint": False}

_STR = {"type": "string"}
_INT = {"type": "integer"}
_BOOL = {"type": "boolean"}
_LABELS = {"type": "array", "items": {"type": "string"}}
#: The three ways an edit names labels: the whole set, or a change of the set the item has.
_EDITED_LABELS = {
    "labels": _LABELS
    | {
        "description": "The whole set: replaces every label the item has. To add or"
        " remove some without knowing the rest, send labels_add or labels_remove instead.",
    },
    "labels_add": _LABELS
    | {
        "description": "Labels to add to the ones the item has; one already there"
        " stays once. Not with labels.",
    },
    "labels_remove": _LABELS
    | {
        "description": "Labels to take off the item; one it does not have is"
        " ignored. Not with labels.",
    },
}
#: The projects an item changes, by their ids in the registry: the whole set.
_PROJECTS = {
    "type": "array",
    "items": {"type": "string"},
    "maxItems": item_projects.MAX_PROJECTS,
}
WORK_ITEM_REFERENCE = {
    "type": "string",
    "description": "A work item, by its reference (MAIN-142) or its work_item_id.",
}
_SPACE = {
    "type": "string",
    "description": "Planning space, by key (MAIN), name, or planning_space_id.",
}
#: What an item names as the work it stands under.
_PARENT = {
    "type": "string",
    "description": "The goal or stage it stands under, by its reference (MAIN-142) or its"
    " work_item_id: an open goal or stage of the same space, at any depth, never the"
    " item itself or one under it. An accepted item does not move under a goal or stage"
    " not accepted; an item in triage moved under goals and stages all accepted is"
    " accepted with them. A task holds no children: convert it first. To take an item out,"
    " use move_out.",
}
#: The one basis of acceptance an agent names itself, read by a creation and a move.
_ACCEPTANCE = {
    "type": "string",
    "enum": [model.NAMED_BASIS],
    "description": "assignment: you accept this work as asked of you. Work under goals and"
    " stages that are all accepted and open is accepted as part of them, whatever this"
    " says, and a claim accepts what it starts without it. Otherwise an item you create"
    " with no state stays in triage unless you name it, and an item with no basis, in"
    " triage, deferred or cancelled out of triage, moved to ready, active, review, blocked"
    " or completed is refused with acceptance without it, force or not.",
}
_STATE = {
    "type": "string",
    "description": "Workflow state, by key or state_id, or by a category ("
    + ", ".join(model.PUBLIC_CATEGORIES)
    + ") when exactly one state of the workflow has it. The states belong to the"
    " space's workflow; read them"
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
#: The four levels of `priority`, each defined; a level added to model.PRIORITIES
#: must be defined here, which the schema test checks.
_PRIORITY_MEANING = (
    "How much the item matters, not when to do it: urgent blocks work or loses data;"
    " high is serious and could block work; medium noticeably affects work, with a"
    " workaround; low is minor. The queue takes urgent work first; otherwise priority"
    " comes after work already started (see claim_ready_work_item)."
)
_VERBOSE = {
    "type": "boolean",
    "description": "Answer with the item's card instead of the short acknowledgement.",
}
#: One checklist step as a caller sends it: its text, or its text and whether it is done.
_STEP = {
    "anyOf": [
        {"type": "string"},
        {
            "type": "object",
            "properties": {"text": _STR, "done": _BOOL},
            "required": ["text"],
        },
    ]
}
_STEPS = {
    "type": "array",
    "maxItems": model.MAX_CHECKLIST,
    "description": "The steps, in order: text, or {text, done}. A step whose text"
    " repeats one the item has is that step, keeping its item_id, claim and tick;"
    " a step sent done=true that was not done is recorded as done by you, as a"
    " tick would record it.",
    "items": _STEP,
}
#: Rows a list or a search answers with when the caller names no limit.
COMPACT_LIMIT = 50
_VERBOSE_ROWS = {
    "type": "boolean",
    "description": "Answer with each item's list record instead of one compact row per item."
    " Without it the answer holds at most limit rows (default"
    f" {COMPACT_LIMIT}).",
}
_OFFSET = {
    "type": "integer",
    "minimum": 0,
    "description": "How many items to skip, for the next page: pass the next_offset"
    " of the previous answer with the same filters.",
}
#: The two parents a reply may name, one at a time.
_REPLY_TO = {
    "type": "integer",
    "minimum": 1,
    "description": "The id of the comment this replies to; a reply to a reply stands under"
    " its root. Not together with reply_to_request.",
}
_REPLY_TO_REQUEST = {
    "type": "string",
    "description": "The id of the question this replies to. Not together with reply_to.",
}
#: What a resolved mark takes, in the single tool and in the batch's group.
_RESOLVED_ROOT = {
    "type": "integer",
    "minimum": 1,
    "description": "The id of the thread's root on this item; a reply is refused.",
}
_RESOLUTION = {
    "type": "string",
    "description": "The decision, one line, in words such as: moved to MAIN-14, postponed,"
    " declined. Leave it out when the thread says it. Not together with reopen.",
}
_REOPEN = {"type": "boolean", "description": "true removes the mark. Not together with resolution."}
#: Why the asker recommends an option or a verdict, which the owner reads on the mark.
_WHY = {
    "type": "string",
    "minLength": 1,
    "maxLength": request_model.MAX_OPTION_DESCRIPTION,
    "description": "Markdown: why you recommend it, shown where the owner points at the"
    " recommendation. Give it whenever you recommend; taken only beside recommended.",
}
#: What got in the way of the work, kept apart from what the work did.
_FRICTION = {
    "type": "string",
    "description": "What hindered the work itself: none, or one line per hindrance. A"
    " closing summary ends its friction here, not in done, next or why.",
}
# A parameter whose name reads as text but whose value is an object is the one an
# agent writes as bare text, and the client then cannot read the call as JSON; it
# fails before it reaches this server. Each such parameter shows its form.
#: What a summary takes: an object, shown as one.
_OUTCOME_FORM = (
    'An object, never bare text: {"done": "what was done", "next": "what comes next"},'
    " with why and friction when they apply."
)
#: What a batch's one comment takes, and where it stands in the discussion.
_COMMENT_FORM = (
    'One comment, an object, never bare text: {"body": "the text"}, with the other'
    " keys beside body when they apply. Without a parent it is the root of a thread;"
    " reply_to (a comment id) or reply_to_request (a question id) makes it a reply"
    " under that root. Threads are one level deep: a reply to a reply stands under"
    " that reply's root, and applied names the root it joined in reply_to or"
    " reply_to_request. A reply carries no checklist_item_id; its root does."
)
#: What a batch's defer takes, and what putting work off does.
_DEFER_FORM = (
    "Put the item off until a day (YYYY-MM-DD, returning at 00:00 UTC), a time, or"
    " another open item's close: until and reason are both required. It moves to its"
    " deferred state, loses its basis and its claims; nothing takes it from the queue."
    " When the day comes or that item closes, is cancelled or deleted, it returns to"
    " triage, or, under goals and stages all accepted, waits as a question to the owner:"
    " do it, later or drop it. An item merged away passes the wait to the item it merged"
    " into. A claim or any transition out of deferred, a cancel included, ends the wait,"
    " but while the question to the owner is open an agent can neither claim the item"
    " nor move it anywhere but cancelled (acceptance_question); moving the item under"
    " another parent keeps the wait. A goal or stage is put off the same way: the work"
    " under it stays with whoever holds it, the queue hands out none of it until it"
    " comes back, and the sessions working under it hear that it was put off and that it"
    " came back. Refused for an item another session holds unless force. Not with"
    " transition, move_out or convert in one call."
)
#: What a batch's convert takes, and what converting keeps and leaves.
_CONVERT_FORM = (
    "Turn a task into a goal or stage, or a goal or stage with nothing under it back"
    " into a task. to is stage for a task under a parent, goal for one without, or"
    " task, bug or improvement. The item keeps its number, text, comments, history,"
    " links, questions, subscribers, refs and steps with their ticks; a bug or"
    " improvement kind becomes a label. Claims end, and the holder's session follows"
    " the new goal or stage. A held task leaves its unfinished work in a new task under"
    " it, held by the same holder and started as it was: leftover names its title and"
    " the steps that go there, a claimed step always goes, and its projects go with"
    " it. Refused while a question to the owner on it is open, in review or closed,"
    " and for an item another session holds unless force. Not with transition, defer"
    " or move_out in one call."
)
#: What a batch's transition takes, and the guards it meets.
_TRANSITION_FORM = (
    'An object, never a bare state name: {"state": "done"}, with reason, force,'
    " acceptance, to_check or cancels when they apply. The one path a state changes by,"
    " except putting work off (defer) and taking it out of its goal or stage"
    " (move_out). The"
    " workflow's guards apply: an active state needs a holder after the write"
    " (executor); review and a completed state need every checklist step ticked and a"
    " closing summary, and are refused while a step stands ticked by a holder whose"
    " claim lapsed (previous_holder): tick it again; review also needs to_check, what"
    " the owner is to check, which becomes the owner's question on the item"
    " (review_question); a blocked state needs a stated reason, for a cause outside"
    " Valkama. An agent cannot complete an item, convert it or move it out of review"
    " while a question to the owner on it is open (question). An item with no basis, in"
    " triage, deferred or cancelled out"
    " of triage, moved to ready, active, review, blocked or completed needs one"
    " (acceptance): inherited under goals and stages that are all accepted and open,"
    " else the acceptance you send. A move to triage takes the basis away. A goal or"
    " stage is accepted by a move to ready, after which it shows state null and its"
    " container_state; accepted out of triage or deferred, it accepts the work in"
    " triage under it, stopping at a deferred goal or stage. It then"
    " moves to completed or cancelled, never to active, review, blocked or back to"
    " triage, and one never accepted is cancelled, not completed. It completes only"
    " with nothing open under it (children): when the last item under it closes it"
    " awaits confirmation, the answer names it in awaiting_confirmation, and completing"
    " it is the confirmation. Cancelling one with open work under it is refused with"
    " the list of what would close and a list_token (cancel_list): send the same"
    " transition with cancels set to that token to cancel it all; a list that changed"
    " meanwhile is refused again with the new one. Entering deferred is refused: use"
    " defer. An agent moves an item the owner is asked whether to take up again only"
    " to cancelled (acceptance_question)."
    " A cancelled state needs only the summary, saying why the work stopped; its undone"
    " steps stay open. force carries a refusal through and records it, except executor,"
    " acceptance, deferred, children, question, review_question, cancel_list,"
    " acceptance_question and the refusals that"
    " keep a goal or stage out of work. Any"
    " state but an active or blocked one"
    " also ends the item's claim and any step claim, whoever holds them; the answer"
    " names the holder as released, and last_claim_ref keeps reading it. A close also"
    " ends the item's pending questions and lists, expired as item_completed or"
    " item_cancelled. Reopening restores no claim and no question. An"
    " agent's close is refused with person_spoke while a person acted on the item in"
    " the interface since an agent last wrote to it; the refusal quotes it."
)
#: A list the owner ticks under a root comment, a report or a summary: a question of
#: one multi_choice field that nobody waits for.
_LIST = {
    "type": "object",
    "description": "Options the owner may tick under this root, written as a question's"
    " options; the answer adds list_request_id. Nobody waits for it: no alert, and it"
    " does not hold the item open. Refused on a reply and beside a closing transition.",
    "properties": {
        "label": _STR,
        "options": {
            "type": "array",
            "minItems": 1,
            "maxItems": requests.MAX_LIST_OPTIONS,
            "items": {
                "type": "object",
                "properties": {
                    "id": _STR,
                    "label": _STR,
                    "description": _STR,
                    "recommended": _BOOL,
                    "why": _WHY,
                },
                "required": ["id", "label"],
            },
        },
    },
    "required": ["label", "options"],
}
#: The other items a comment tells, beside what its text links.
_MENTIONS = {
    "type": "array",
    "maxItems": mention_records.MAX_AGENT_MENTIONS,
    "items": {"type": "string"},
    "description": "Other items to tell, by reference: each one's holders hear this comment at"
    " their next tool call, and it stays on the item for whoever takes it. A number in the body"
    f" tells nobody. A session names one item at most {mention_records.MAX_PER_HOUR} times an"
    " hour. The answer says who will hear each.",
}
#: The other items a summary or a description tells: the same, but a text saved again
#: tells only what the text it replaces did not name.
_TEXT_MENTIONS = {
    **_MENTIONS,
    "description": "Other items the summary or the description tells, by reference, as a"
    " comment's mentions do; a description's go with the description. A number in the text"
    " tells nobody. Saved again, it tells only the items the text it replaces did not name."
    " The answer's mentions says who will hear each.",
}
_AWAITS_REPLY = {
    "type": "boolean",
    "description": "Set only before ending your turn to wait for another agent, never for"
    " information: wakes the holders here and of mentions once, and the first reply by"
    " another session or a person wakes you once. get_work_item shows answered.",
}
#: The most open members one page of get_work_item_chain carries.
CHAIN_PAGE = 200
#: How many of a chain's newest series entries get_work_item_chain carries.
CHAIN_SERIES_ENTRIES = 30
#: One part of a work item by name, the form `parts` takes for each.
_PART = {"type": "string", "enum": list(read_model.PARTS)}
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
        "Every planning space with its key, its projects and default project, its launch"
        " place and how much work it holds. session_space names the space whose project"
        " root holds your session's folder.",
        READ_ONLY,
        {},
    ),
    _tool(
        "get_planning_space",
        "Read a planning space",
        "One space and its workflow: the states, their categories, and the"
        " transitions between them, its projects with their roots, and its launch place."
        " Read this before asking for a state by name.",
        READ_ONLY,
        {"space": _SPACE},
        ["space"],
    ),
    _tool(
        "create_planning_space",
        "Create a planning space",
        "A new space with the default workflow and no projects. Its key is derived from"
        " the name unless you name one. A project joins a space through the registry"
        " command: valkama projects bind <project> --space <KEY>.",
        WRITES,
        {"name": _STR, "key": _STR},
        ["name"],
    ),
    _tool(
        "create_work_item",
        "Create a work item",
        "One unit of planned work. kind is task, bug or improvement for work an agent"
        " takes, goal or stage for work that holds other work: a goal stands under no"
        " parent and a stage under one, at any depth. A goal or stage is never claimed or"
        " worked itself; once accepted it shows state null and its container_state."
        " Without state, an item under goals and stages that are all accepted and open"
        " is accepted as part of them; another an agent files starts in triage unless"
        " acceptance accepts it. Accepted, a task starts in ready and a goal or stage"
        " stands accepted at once. A named state meets the refusals a move there does,"
        " and a new item is never created in review, blocked, completed or cancelled:"
        " create it, then move it there with transition (new_item)."
        " A goal you create is followed for your session from the start, as subscribe"
        " true would, so its news reaches you; a stage subscribes nobody."
        " claim, checklist and links act on the new item in the same call, all or"
        " nothing: it is created, then claimed, then given its steps, then linked,"
        " each as the same group of apply_work_item_changes does. A refused step"
        " creates nothing and names the"
        " step and the refusal's code. With any of them, the answer adds applied,"
        " what each changed. The answer's similar names up to three open items of the"
        " space whose title or description share the new title's words, best first,"
        " each by reference and title: read them, and merge the new item into one that"
        " is the same change. A hint, not a check: nothing is refused on it, and an"
        " empty list does not prove there is no duplicate. projects names the projects"
        " the item changes. space is where it lies: leave it out and the server places it"
        " under its parent's space, else in the home space of its projects, else in your"
        " session's space. Projects of two spaces need space, one of them. A goal or"
        " stage names no projects.",
        WRITES,
        {
            "space": _SPACE,
            "title": _STR,
            "state": _STATE,
            "kind": {"type": "string", "enum": list(model.PUBLIC_KINDS)},
            "priority": {
                "type": "string",
                "enum": list(model.PRIORITIES),
                "description": _PRIORITY_MEANING,
            },
            "description": _STR,
            "labels": _LABELS,
            "projects": _PROJECTS,
            "source": {
                "type": "string",
                "description": "Anchor into the owning document, e.g."
                " docs/plan.md#kb:a7f3. Point at the immutable <!-- kb:xxxx -->"
                " comment; never copy the plan text into the item.",
            },
            "parent": _PARENT,
            "acceptance": _ACCEPTANCE,
            "split_from": {
                **WORK_ITEM_REFERENCE,
                "description": "An open task to split a part off: the new item stands beside"
                " it under the same parent, accepted as it is, and takes the steps named in"
                " steps with their ids and ticks. Refused for a task in review and with a"
                " parent, state or acceptance of its own. The answer names split_from and"
                " the moved_steps.",
            },
            "steps": {
                "type": "array",
                "maxItems": model.MAX_CHECKLIST,
                "items": {"type": "string"},
                "description": "With split_from: the ids of its steps the part takes.",
            },
            "force": {
                "type": "boolean",
                "description": "With split_from: split a part off a task another session"
                " holds, recorded as overridden on it.",
            },
            "claim": {
                "type": "boolean",
                "description": "true claims the new item as claim_work_item does,"
                " which starts it: it is created in its first state and then moved"
                " to the active one. A goal or stage is refused and nothing is created.",
            },
            "checklist": {
                "type": "object",
                "description": "The new item's steps, as apply_work_item_changes takes"
                ' them: the list alone, ["first step", {"text": "…", "done": true}], or'
                ' {"items": [...]}; applied after the claim and before the links.',
                "properties": {"items": _STEPS},
                "required": ["items"],
            },
            "links": {
                "type": "array",
                "maxItems": api.MAX_APPLY_ENTRIES,
                "description": "Links from the new item, as apply_work_item_changes takes them:"
                " work found en route links discovered-from the item it was found from.",
                "items": {
                    "type": "object",
                    "properties": {
                        "other": WORK_ITEM_REFERENCE,
                        "kind": {"type": "string", "enum": sorted(model.LINK_KINDS)},
                    },
                    "required": ["other", "kind"],
                },
            },
            "author": _AUTHOR,
            "verbose": _VERBOSE,
        },
        ["title"],
    ),
    _tool(
        "get_work_item",
        "Read a work item",
        "One item. By default its card: reference, title, kind, priority, state, open,"
        " container_state, acceptance, started_at, waits_for, cancelled_blockers (the"
        " cancelled items still linked to block it, only when there are any), workable,"
        " withheld, projects, claim_ref, claim_state, last_claim_ref, lapsed_claim, labels, revision, parent,"
        " url, description, checklist (each condition with its id) and summary, and parts:"
        " every other part it has, with count and size. parts names what to read: "
        + ", ".join(read_model.PARTS[:-2])
        + " and, on a goal or stage, participants, and confirmation while it awaits"
        " confirmation: what was cancelled and moved out under it, with each reason, and"
        " its steps, 0 meaning its description is what to check; each comes as the field"
        " of that name"
        f" beside reference and revision. comments: the {read_model.PART_THREADS} threads"
        " with the newest activity, each root with replies (how many) and last_reply;"
        " thread one thread whole; unresolved the roots without the resolved mark, oldest"
        f" first, at most {read_model.UNRESOLVED_PAGE}, with truncated, the next page being"
        " comments_after the last root read; comments_after alone every comment after that"
        f" id, roots and replies alike, at most {read_model.COMMENTS_PAGE} with truncated, 0"
        f" starting from the first. events: the newest {read_model.PART_EVENTS} history"
        " events, or the newest n, with events_total and events_truncated. questions: its"
        " questions in compact form: total, open, at most"
        f" {requests.ITEM_QUESTIONS} items with the open ones first; requests asked of agent"
        " sessions stay out of them, and addressed_open counts the open ones; after a resume"
        " or a compaction, your session's Valkama note names the items with one asked of"
        " it in Waiting for your answer. claim: the"
        " lease, with"
        " expires_at. sections: the description's sections, by heading or, without"
        " headings, by paragraph, each with its key and size; section reads the ones named,"
        " so a long description is refreshed without reading it all. Each comment names its"
        " parent in reply_to or reply_to_request (null on a root), by_person, resolution, a"
        " root's mark, and mentions, the items it told. A comment mode, events or section"
        " without parts reads that part alone. An accepted"
        " open goal or stage shows state null and container_state: not_started,"
        " in_progress or awaiting_confirmation. workable says whether its space's queue may"
        " give it now and withheld why not: goal_or_stage, not_ready, held, waits,"
        " question, no_start, ancestor_triage, ancestor_deferred, ancestor_waits or"
        " ancestor_closed. claim.expires_at is when the claim lapses if its session stays"
        " silent, or, for a claim no session proved, the owner's own included, if the item"
        " stays quiet; null while an open question to the owner stops that count. A"
        " checklist step with by_previous_holder was ticked by a holder whose claim"
        " lapsed: tick it again to confirm it before review or closing. lapsed_claim"
        " names the holder whose claim the sweep released, why and when, until the next"
        " claim.",
        READ_ONLY,
        {
            "id": WORK_ITEM_REFERENCE,
            "parts": {
                "anyOf": [_PART, {"type": "array", "items": _PART}],
                "description": "What to read: card, the default, or any other part by"
                " name; one name reads as a list of it.",
            },
            "unresolved": {
                "type": "boolean",
                "description": "Read one page of the roots without the resolved mark, each"
                " with replies and last_reply; comments_after is where the next page starts."
                " Not together with thread.",
            },
            "thread": {
                "type": "integer",
                "minimum": 1,
                "description": "A comment id: read its thread, the root and every reply"
                " oldest first; a reply's id reads its root's thread. Not together with"
                " comments_after.",
            },
            "comments_after": {
                "type": "integer",
                "minimum": 0,
                "description": "A comment id: read one flat page of the comments after it,"
                " oldest first, 0 starting from the first; beside unresolved, where the next"
                " page of roots starts.",
            },
            "events": {
                "type": "integer",
                "minimum": 1,
                "maximum": read_model.PART_EVENTS_MOST,
                "description": "How many of the newest history events to read.",
            },
            "section": {
                "anyOf": [_STR, {"type": "array", "items": _STR, "minItems": 1}],
                "description": "A key of the description's sections, as the sections part"
                " names them, or a list of keys: read those sections with their text, in the"
                " description's order.",
            },
        },
        ["id"],
    ),
    _tool(
        "read_work_item_image",
        "Read a picture on a work item",
        "One picture pasted into the item's description or discussion, as an image the"
        " client shows you, with its sha256, media_type and size. Name it by the sha256"
        " from get_work_item's images, or the last part of its /api/images/ path.",
        READ_ONLY,
        {
            "id": WORK_ITEM_REFERENCE,
            "sha256": {
                "type": "string",
                "pattern": "^[0-9a-f]{64}$",
                "description": "The picture's SHA-256, as get_work_item lists it.",
            },
        },
        ["id", "sha256"],
    ),
    _tool(
        "list_work_items",
        "List work items",
        "Items in state order, and inside a state in the order of work (see"
        " claim_ready_work_item), filtered by state, category, kind, holder or parent. One"
        " compact row per item: reference, title, kind, state, priority, parent and holder;"
        " an accepted open goal or stage has state null and adds its container_state. A row"
        " the queue gives adds queue_order, its place in its space's queue; any other row"
        " adds withheld, why the queue does not give it. With space, the list holds that"
        " space's items and other spaces' items that name one of its projects, marked"
        " other_space. project keeps the items that name that project, in every space"
        " unless space is given; a goal or stage names what a task under it names."
        " kind=goal lists the goals, kind=stage the stages."
        f" A page holds at most {service.MAX_LIST_PAGE} items." + _PAGING,
        READ_ONLY,
        {
            "space": _SPACE,
            "state": _STATE,
            "category": {"type": "string", "enum": list(model.PUBLIC_CATEGORIES)},
            "kind": {"type": "string", "enum": list(model.PUBLIC_KINDS)},
            "owner": {
                "type": "string",
                "description": "Only items held by this holder, spelled exactly as"
                " claim_ref is: a confirmed session holds as 'codex (session <id>)',"
                " which a claim's acknowledgement returns.",
            },
            "parent": {
                "type": "string",
                "description": "Only the children of this item, by its reference (MAIN-142)"
                " or its work_item_id.",
            },
            "project": {
                "type": "string",
                "description": "Only the items that name this project, by its id in the"
                " project registry.",
            },
            "limit": _INT,
            "offset": _OFFSET,
            "verbose": _VERBOSE_ROWS,
        },
    ),
    _tool(
        "get_work_item_chain",
        "Read a chain of work",
        "What one item's work grew into and whether it converges. scope=tree counts"
        " everything under the item, at any depth; scope=chain (the default) adds,"
        " transitively, every item discovered from it or from a member and every child"
        " of a member; relates-to, duplicates and blocks never widen it. Answers with"
        " total, closed, open, workable, by_category, by_container_state (accepted"
        " goals and stages by what they derive), origins (members grouped by parent),"
        f" the newest {CHAIN_SERIES_ENTRIES} entries of series (one per day with a"
        " change) and recent: the last 7 UTC"
        " days' created and closed and a trend of growing, converging or steady."
        " open_members lists the open members, active first, then review, then"
        " workable, then the rest, each in the order of work; a row's queue_order is its"
        " place in its space's queue, null when the queue does not give it; at most"
        f" {CHAIN_PAGE} per page." + _PAGING,
        READ_ONLY,
        {
            "id": WORK_ITEM_REFERENCE,
            "scope": {"type": "string", "enum": ["chain", "tree"]},
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
        "Find the items holding every word of the query, in any order and in any of their"
        " title, description, labels, projects, summary, comments and questions (a question's"
        " prompt, field and option text and its answer and note), best match first, the title"
        " weighing most. Each word matches by its first five letters, so searching finds"
        " search; two or three telling words find more than a sentence. A query that is"
        " exactly a reference, such as MAIN-12 in any case, is read as one phrase and"
        " answers that item first; a number alone, such as 12, answers the item of that"
        " number first in each space."
        " One compact row per item, with the comment line or question holding the words"
        " when that is where they are."
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
        "claim_work_item",
        "Claim a work item",
        "Take ownership before working it. Refuses if somebody else holds it;"
        " force takes it over and records the takeover, release hands it back."
        " Only a task is held: a goal or stage is refused, a task in review too (the"
        " owner's answer returns it to ready), and a closed one until it is reopened."
        " Claiming a task in a triage, deferred or ready state starts it: it moves to the"
        " workflow's first active state it can reach, and the answer's started"
        " names both states; with no active state to reach the claim is refused. One"
        " not under goals and stages that are all accepted and open is accepted by"
        " assignment. A blocked task stays blocked. Releasing an active task puts it back"
        " in the first ready state, named in requeued, unless one of its checklist steps"
        " is still claimed; with no ready state to reach the release is refused, since"
        " nothing at work stands unheld, and so is taking over a stale claim there. A"
        " released blocked task stays blocked, held by nobody. A transition to any state"
        " but an active or blocked one releases the item already: no release follows it."
        " The answer names the root of each project the task changes in project_roots:"
        " read each one's instructions before editing it."
        " The answer carries from_person when"
        " a person acted on the item in the interface since an agent last wrote to it:"
        " their words about this work, to read before the next step, each text whole up to"
        " 1500 characters and marked cut past them."
        " It carries waiting when a person's words on a goal or stage above the work found"
        " nobody working there: read them before you start.",
        WRITES,
        {
            "id": WORK_ITEM_REFERENCE,
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
        "Choose and claim in one step the next task the queue gives: a task in a ready"
        " state, unheld, with nothing unfinished blocking it and no open question to the"
        " owner, under no goal or stage that is in triage, deferred, closed or blocked."
        " Order: urgent first, then work already started, then tasks of a goal or stage"
        " already under way, then by priority, oldest first. The queue is one space's:"
        " space, else the space of within, else the space whose project root holds your"
        " session's folder (session_space in list_planning_spaces). within (a goal or"
        " stage, at any depth), label and project narrow it; project keeps the tasks that"
        " name that project. A task of any space is claimed by number with claim_work_item."
        " The claim starts the task as claim_work_item does. The answer names the root of"
        " each project the task changes in project_roots: read each one's instructions"
        " before editing it. Answers with nothing when no task is workable; a record's"
        " withheld says why an item is not given."
        " The answer carries waiting when a person's words on a goal or stage above the"
        " work found nobody working there: read them before you start.",
        WRITES,
        {
            "space": _SPACE,
            "within": {
                "type": "string",
                "description": "A goal or stage, by its reference (MAIN-142) or its"
                " work_item_id: only the tasks under it, at any depth. Beside space it must"
                " be of that space.",
            },
            "label": {
                "type": "string",
                "description": "Only the tasks that carry this label themselves, not through a"
                " goal or stage over them.",
            },
            "project": {
                "type": "string",
                "description": "Only the tasks that name this project, by its id in the project"
                " registry; a task that names none is kept by no project.",
            },
            "author": _AUTHOR,
        },
    ),
    _tool(
        "claim_work_item_checklist_item",
        "Claim one checklist step",
        "Take one step so two agents can split an item without either inventing"
        " a percentage. Refuses another holder's step unless force, and, as a claim of"
        " the item does, every step of a goal or stage and of a task in review or closed."
        " Claiming a step of a task in a triage, deferred or ready state starts the task"
        " as claiming it would. When the last held step of an active task nobody holds"
        " is released, the task goes back to the first ready state, named in requeued;"
        " with no ready state to reach the release is refused."
        " The answer carries waiting when a person's words on a goal or stage above the"
        " work found nobody working there: read them before you start.",
        WRITES,
        {
            "id": WORK_ITEM_REFERENCE,
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
        "merge_work_items",
        "Merge work items into one",
        "Fold items that are one change — one cause, one fix — into the item that"
        " survives (id), all or nothing. Their checklist steps, keeping ids, ticks"
        " and step claims, their discussion threads whole, questions with their"
        " replies, refs, links and projects move to it; each merged item is linked"
        " duplicates to it, gets a summary naming it, is released and closes in its"
        " cancelled state. A project more than one of them names keeps the strongest"
        " source: named, then commits, then migrated. Their history, reports with their threads, description and parent"
        " stay on them. Refused before anything is written:"
        " an item in another space, a closed item, a merged item with children, a goal"
        " or stage with a task (goals and stages merge only with each other),"
        f" more than {model.MAX_CHECKLIST} steps in all, or an item another session"
        " holds unless force. The answer lists what each item moved. An item put off"
        " until a merged item waits for the survivor instead.",
        WRITES,
        {
            "id": {
                "type": "string",
                "description": "The item that survives, by its reference (MAIN-142) or"
                " its work_item_id.",
            },
            "items": {
                "type": "array",
                "minItems": 1,
                "maxItems": service.MAX_MERGE_ITEMS,
                "items": {"type": "string"},
                "description": "The items that merge into id and close as its duplicates.",
            },
            "reason": {
                "type": "string",
                "description": "Why they are one change; recorded on both sides.",
            },
            "force": _FORCE,
            "expected_revision": {
                **_EXPECTED_REVISION,
                "description": "The survivor's revision from a previous read; rejects a"
                " stale merge.",
            },
            "author": _AUTHOR,
            "verbose": _VERBOSE,
        },
        ["id", "items"],
    ),
    _tool(
        "apply_work_item_changes",
        "Apply several changes to a work item",
        "Several writes to one item in one call, all or nothing. The groups apply"
        " in this order: claim,"
        " subscribe, update, convert, checklist, checklist_ticks, refs, links, comment or"
        " comments,"
        " resolutions, questions, summary, then one of transition, defer or move_out — so a"
        " claim and"
        " its steps take one call, and a closing"
        " transition sees the ticks and the summary sent with it, and a transition"
        " sent with claim moves an item the claim has already started; a closing"
        " transition releases the claim, so no release call follows. A refused step"
        " writes nothing and names the step and the refusal's code. Name at least"
        " one group. Answers with the acknowledgement and applied, what each group"
        " changed, and from_person when a person acted on the item since an agent"
        " last wrote, each text whole up to 1500 characters and marked cut past them."
        " The call is one write: its comment does not lift a closing"
        " transition's person_spoke refusal.",
        WRITES,
        {
            "id": WORK_ITEM_REFERENCE,
            "claim": {
                "type": "boolean",
                "description": "true claims the item as claim_work_item does,"
                " starting it when it is in a triage, deferred or ready state; the answer"
                " then carries waiting as claim_work_item's does.",
            },
            "subscribe": {
                "type": "boolean",
                "description": "true: this session hears other sessions' news on the item"
                " as its holder would, a person's acts at its next call; false stops that,"
                " and on an item the session holds, or a goal or stage it holds work under,"
                " mutes other sessions' news there while it holds it (a person's acts and"
                " the replies to its own awaits_reply still come); on a goal or stage it"
                " only follows, false stops following. Written for the proved session and agent, lapsing with the"
                " session; applied.subscribe says following, muted or not_following.",
            },
            "update": {
                "type": "object",
                "description": "Edit the fields a state transition does not own;"
                " applied.update names the fields sent.",
                "properties": {
                    "title": _STR,
                    "description": _STR,
                    "source": {
                        "type": "string",
                        "description": "Anchor into the owning document, e.g."
                        " docs/plan.md#kb:a7f3. Update the existing marker without"
                        " changing the item's identity or copying plan text into it.",
                    },
                    "priority": {
                        "type": "string",
                        "enum": list(model.PRIORITIES),
                        "description": _PRIORITY_MEANING,
                    },
                    **_EDITED_LABELS,
                    "kind": {
                        "type": "string",
                        "enum": sorted(model.TASK_KINDS),
                        "description": "A task's kind, changed among these; a task and a goal"
                        " or stage become each other with convert, and its place says which"
                        " it is.",
                    },
                    "parent": _PARENT,
                    "projects": _PROJECTS
                    | {
                        "description": "projects replaces the projects the item names;"
                        " the item stays in its space.",
                    },
                    "mentions": _TEXT_MENTIONS,
                },
            },
            "convert": {
                "type": "object",
                "description": _CONVERT_FORM,
                "properties": {
                    "to": {"type": "string", "enum": list(model.PUBLIC_KINDS)},
                    "leftover": {
                        "type": "object",
                        "description": "The new task a held task leaves, or one a task"
                        " nobody holds leaves when this is sent: its title, the task's own"
                        " when left out, and the item_ids of the steps that go there.",
                        "properties": {
                            "title": _STR,
                            "steps": {"type": "array", "items": _STR, "maxItems": 100},
                        },
                    },
                    "force": _FORCE,
                },
                "required": ["to"],
            },
            "checklist": {
                "type": "object",
                "description": "Set the steps, after the claim and before the ticks:"
                ' the list alone, ["first step", {"text": "…", "done": true}], or'
                ' {"items": [...], "force": true} when force must carry a refusal'
                " through. A step sent with the text of one the item has keeps that"
                " step's item_id, claim, tick and by_previous_holder, so appending is"
                " sending the old steps"
                " and then the new ones; a new step gets a new item_id, which"
                " checklist_ticks in the same call cannot name: send it done=true"
                " instead. Leaving out a claimed or completed step is refused, naming"
                " it; force discards it explicitly. applied.checklist lists every"
                " item_id.",
                "properties": {"items": _STEPS, "force": _FORCE},
                "required": ["items"],
            },
            "checklist_ticks": {
                "type": "array",
                "maxItems": api.MAX_APPLY_ENTRIES,
                "description": "Steps to complete, or to reopen with done=false."
                " Completion records who and clears the live claim; when that was the"
                " last hold on an active task nobody holds, the batch's end puts the task"
                " back in the first ready state, and with none to reach it is refused."
                " Ticking a step again confirms a tick its lapsed holder made and clears"
                " by_previous_holder.",
                "items": {
                    "type": "object",
                    "properties": {"item_id": _STR, "done": _BOOL, "force": _FORCE},
                    "required": ["item_id"],
                },
            },
            "refs": {
                "type": "array",
                "maxItems": api.MAX_APPLY_ENTRIES,
                "description": "Structured pointers to attach: a commit, an AgentMemory"
                " record id or a url. Attach every memory record materially used for"
                " this work as kind=memory with its stable id; this is a one-way"
                " pointer and never writes back. Your own session needs no ref:"
                " Valkama records the confirmed session of every write itself. Raw"
                " logs and files do not belong here.",
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
                "description": "Links from this item. blocks carries readiness;"
                " relates-to, discovered-from and duplicates carry meaning. relates-to"
                " is one link whichever end names it, and linking it again from the"
                " other end changes nothing. remove=true takes the link away, a"
                " relates-to one from either end.",
                "items": {
                    "type": "object",
                    "properties": {
                        "other": WORK_ITEM_REFERENCE,
                        "kind": {"type": "string", "enum": sorted(model.LINK_KINDS)},
                        "remove": _BOOL,
                    },
                    "required": ["other", "kind"],
                },
            },
            "comment": {
                "type": "object",
                "description": _COMMENT_FORM,
                "properties": {
                    "body": _STR,
                    "checklist_item_id": _STR,
                    "reply_to": _REPLY_TO,
                    "reply_to_request": _REPLY_TO_REQUEST,
                    "list": _LIST,
                    "mentions": _MENTIONS,
                    "awaits_reply": _AWAITS_REPLY,
                },
                "required": ["body"],
            },
            "comments": {
                "type": "array",
                "maxItems": api.MAX_APPLY_ENTRIES,
                "description": "Comments, each as comment takes it, written in order;"
                " not together with comment. A parent must exist before the call."
                " applied.comments lists each comment_id.",
                "items": {
                    "type": "object",
                    "properties": {
                        "body": _STR,
                        "checklist_item_id": _STR,
                        "reply_to": _INT,
                        "reply_to_request": _STR,
                        "list": _LIST,
                        "mentions": _MENTIONS,
                        "awaits_reply": _AWAITS_REPLY,
                    },
                    "required": ["body"],
                },
            },
            "resolutions": {
                "type": "array",
                "maxItems": api.MAX_APPLY_ENTRIES,
                "description": "Thread roots to mark resolved, which collapses the thread"
                " and leaves it out of the unresolved read, with a one-line decision of"
                f" at most {service.MAX_RESOLUTION} characters that may be left out;"
                " reopen=true removes the mark, and marking again replaces the decision."
                " A reply and a question's thread take no mark, and the mark changes no"
                " revision. applied.resolutions lists each root's mark as it now stands.",
                "items": {
                    "type": "object",
                    "properties": {
                        "comment_id": _RESOLVED_ROOT,
                        "resolution": _RESOLUTION,
                        "reopen": _REOPEN,
                    },
                    "required": ["comment_id"],
                },
            },
            "questions": {
                "type": "array",
                "maxItems": api.MAX_APPLY_ENTRIES,
                "description": "Questions, each as create_work_item_request takes it. Without"
                " addressees it asks the owner, and applied.questions lists each request_id"
                " and revision. With addressees it asks agent sessions, as that tool does,"
                " and applied.questions lists each entry's requests, each request_id with"
                " its addressee. Refused beside a transition that closes the item, which"
                " would end them unanswered.",
                "items": {
                    "type": "object",
                    "properties": {
                        "kind": {"type": "string", "enum": ["question", "decision"]},
                        "prompt": _STR,
                        "fields": {"type": "array", "items": {"type": "object"}},
                        "execution_id": _STR,
                        "session_id": _STR,
                        "expires_at": _STR,
                        "addressees": {
                            "type": "array",
                            "minItems": 1,
                            "maxItems": requests.MOST_ADDRESSEES,
                            "items": _STR,
                            "description": "Top-level agent session ids to ask instead of the"
                            " owner, as create_work_item_request takes them.",
                        },
                    },
                    "required": ["kind", "prompt", "fields"],
                },
            },
            "summary": {
                "type": "object",
                "description": "The closing summary: what was done, what comes next, and"
                " why only when the choice is not obvious. A terminal state needs it; it"
                " is what the next agent reads instead of re-deriving the work. " + _OUTCOME_FORM,
                "properties": {
                    "done": _STR,
                    "next": _STR,
                    "why": _STR,
                    "friction": _FRICTION,
                    "list": _LIST,
                    "mentions": _TEXT_MENTIONS,
                },
                "required": ["done", "next"],
            },
            "transition": {
                "type": "object",
                "description": _TRANSITION_FORM,
                "properties": {
                    "state": _STATE,
                    "reason": _STR,
                    "force": _FORCE,
                    "acceptance": _ACCEPTANCE,
                    "to_check": {
                        "type": "string",
                        "maxLength": 8000,
                        "description": "With a move into review only: what the owner is to"
                        " check, asked as the owner's question on the item. The owner's"
                        " answer completes the item or returns it to work; the answer names"
                        " the question as review_request_id.",
                    },
                    "cancels": {
                        "type": "string",
                        "maxLength": 64,
                        "description": "With cancelling a goal or stage only: the list_token"
                        " of the cancel_list refusal, confirming that list. Everything open"
                        " under it is cancelled in the same write, and the answer names it"
                        " as cancelled, the claims that ended as released and the work"
                        " nothing blocks any more as freed.",
                    },
                },
                "required": ["state"],
            },
            "defer": {
                "type": "object",
                "description": _DEFER_FORM,
                "properties": {
                    "until": {
                        "type": "string",
                        "maxLength": 64,
                        "description": "A day YYYY-MM-DD, coming back at 00:00 UTC; a time"
                        " with its zone, such as 2026-12-01T09:00:00Z; or the reference or"
                        " work_item_id of the open item whose close it waits on.",
                    },
                    "reason": _STR,
                    "force": _FORCE,
                },
                "required": ["until", "reason"],
            },
            "move_out": {
                "type": "object",
                "description": "Take the item out of its goal or stage, with the reason: it goes"
                " to the top level and to triage, keeps that it started, and loses its claims"
                " and its basis. The goal or stage it left records the reason. The one way to"
                " clear a parent. Refused for an item another session holds unless force;"
                " not with transition, defer or convert in one call.",
                "properties": {"reason": _STR, "force": _FORCE},
                "required": ["reason"],
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
        "Removes the item and its trail. Refuses while it still has children. Items put"
        " off until it return as if it closed.",
        DESTRUCTIVE,
        {"id": WORK_ITEM_REFERENCE},
        ["id"],
    ),
]

_REQUEST_FIELD = {
    "type": "object",
    "properties": {
        "id": _STR,
        "label": _STR,
        "type": {
            "type": "string",
            "enum": ["text", "choice", "multi_choice", "boolean", "verdict"],
            "description": "verdict: one row of a review, a point the owner accepts, puts off or"
            " rejects; its options is [] and its answer accept, later or reject.",
        },
        "required": _BOOL,
        "description": {
            "type": "string",
            "minLength": 1,
            "maxLength": request_model.MAX_OPTION_DESCRIPTION,
            "description": "Markdown: what the field asks, or the point a verdict decides.",
        },
        "group": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "description": "The section heading; the fields of one group stand together."
            " A field under another leaves it out.",
        },
        "under": {
            "type": "object",
            "description": "Shown and answered only while the answer of an earlier verdict,"
            " choice or multi_choice field holds option: accept, later or reject under a"
            " verdict, an option id otherwise. One level. Put the steps or ways of a point"
            " here, as one more entry of fields, never in a label or a description.",
            "properties": {"field": _STR, "option": _STR},
            "required": ["field", "option"],
        },
        "recommended": {
            "type": "string",
            "enum": list(request_model.VERDICTS),
            "description": "On a verdict only: what the asker recommends. A choice or"
            " multi_choice recommends on its options.",
        },
        "why": _WHY,
        "options": {
            "type": "array",
            "maxItems": 20,
            "items": {
                "type": "object",
                "properties": {
                    "id": _STR,
                    "label": _STR,
                    "description": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": request_model.MAX_OPTION_DESCRIPTION,
                        "description": "Markdown: what choosing this option means or costs.",
                    },
                    "recommended": {
                        "type": "boolean",
                        "description": "The option the asker recommends. At most one in a"
                        " choice field; any number in a multi_choice field.",
                    },
                    "why": _WHY,
                },
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
            "Create a typed question or decision on an item. The fields of one question fit in"
            " 64 KiB as stored. A review is a verdict field per proposal, its steps or ways in"
            " a field under it, and a group per area. Does not change workflow or execution"
            " lifecycle. addressees asks other agent sessions instead of the person: up to"
            f" {requests.MOST_ADDRESSEES} top-level session ids, as participants, subscribers"
            " and holders name them. Each gets its own request, which wakes it; its answer"
            f" wakes you. A session is asked at most {requests.MOST_ASKS_PER_HOUR} times an"
            " hour by yours (ask_limit). Ask for an answer in fields before you go on; for a"
            " free exchange write a comment with awaits_reply.",
            WRITES,
            {
                "id": WORK_ITEM_REFERENCE,
                "kind": {"type": "string", "enum": ["question", "decision"]},
                "prompt": _STR,
                "fields": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": request_model.MAX_FIELDS,
                    "items": _REQUEST_FIELD,
                },
                "author": _AUTHOR,
                "execution_id": _STR,
                "session_id": _STR,
                "expires_at": _STR,
                "addressees": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": requests.MOST_ADDRESSEES,
                    "items": _STR,
                    "description": "Top-level agent session ids to ask instead of the person;"
                    " the answer is requests, each request_id with its addressee.",
                },
            },
            ["id", "kind", "prompt", "fields"],
        ),
        _tool(
            "get_work_item_request",
            "Read a human request",
            "Read one whole question: its prompt, fields with option descriptions, answers,"
            " own (an own variant by field), field_notes (a comment by field), note (a comment"
            " on the whole question), answer_version, history (the answers a change replaced,"
            " oldest first), replies (its whole thread, oldest first), effective expiry, and"
            " by_person: true when the latest call that closed or changed it came through"
            " Valkama's interface, false for any other call, null while none has. No argument"
            " sets it; a process holding the interface's credentials counts as the interface.",
            READ_ONLY,
            {"id": _STR},
            ["id"],
        ),
        _tool(
            "list_work_item_requests",
            "List human requests",
            "List questions in the primary store, in compact form: id, status, question (the"
            f" first {request_model.QUESTION_PREVIEW} characters of the prompt), answer as rows of"
            " field, value and label, with own and note when the field has them, note,"
            " answered_by, by_person, answered_at, answer_version, previous (the answer a change"
            " replaced) from version 2, replies and last_reply. A review adds verdicts (each"
            " verdict field by its word) and undecided, and its answer holds only the fields under"
            " another, with under and of, and verdicts with a comment or own variant. A note or a"
            f" written answer is cut at {request_model.MAX_COMPACT_TEXT} characters and one"
            f" question at {request_model.MAX_COMPACT_JSON} characters of JSON, previous first,"
            " then every label, then the later fields, and carries clipped=true when anything was"
            " cut. full=true gives each"
            " whole. With answered_after the oldest answer comes first, a changed answer comes"
            " again, and a page runs past limit rather than part two answers of one time."
            " addressed=true lists the open requests asked of your own session; answer each with"
            " answer_work_item_request." + _PAGING,
            READ_ONLY,
            {
                "space": _SPACE,
                "id": WORK_ITEM_REFERENCE,
                "status": {
                    "type": "string",
                    "enum": ["pending", "answered", "declined", "expired"],
                },
                "answered_after": {
                    "type": "string",
                    "description": "An ISO timestamp with a timezone: only answers given after it,"
                    " oldest first, so a reader that keeps the last answered_at it read takes what"
                    " came since. While truncated is true, ask again from the last answered_at.",
                },
                "limit": _INT,
                "offset": _OFFSET,
                "full": {
                    "type": "boolean",
                    "description": "Answer with each whole question instead of the compact form.",
                },
                "addressed": {
                    "type": "boolean",
                    "description": "Only the open requests another session or Valkama asked of"
                    " the session of this call. Without it a request asked of a session is left"
                    " out.",
                },
            },
        ),
        _tool(
            "answer_work_item_request",
            "Answer a human request",
            "Answer a pending question once using the request revision. A required field is"
            " answered by a value or by its own variant; a note no longer stands in for it."
            " change=true replaces the answer of an answered question instead, while its item is"
            " open: the replaced answer is kept as a version. Change one only when the owner asks."
            " Does not resume an execution. A request asked of a session (its addressee) is"
            " answered only by that session, its conversation or any of its subagents; any other"
            " caller, the interface included, is refused with not_addressed. A request whose"
            " addressee ended or went quiet reads expired with session_gone. A question with a"
            " purpose (review, confirm, return) carries its answer out in the same write, and"
            " is never declined or changed. Only the owner answers it, in Valkama (owner_only),"
            " and only the session that asked withdraws it (not_asker).",
            WRITES,
            {
                "id": _STR,
                "answers": {
                    "type": "object",
                    "description": "Field id to answer, each checked against its field.",
                },
                "own": {
                    "type": "object",
                    "description": "Field id to an own variant, at most"
                    f" {request_model.MAX_OWN} characters: in a choice or boolean field instead of"
                    " an option, in a multi_choice field beside the chosen ones. A text field has"
                    " none.",
                },
                "field_notes": {
                    "type": "object",
                    "description": "Field id to a comment on that field, at most"
                    f" {request_model.MAX_FIELD_NOTE} characters. A text field takes none.",
                },
                "note": {
                    "type": "string",
                    "maxLength": request_model.MAX_NOTE,
                    "description": "A comment on the whole question; it answers no field.",
                },
                "change": {
                    "type": "boolean",
                    "description": "Replace the current answer of an answered question. Refused"
                    " when nothing differs, on a closed item, and past"
                    f" {request_model.MAX_ANSWER_VERSIONS} versions.",
                },
                "expected_revision": _EXPECTED_REVISION,
                "author": _AUTHOR,
            },
            ["id", "answers", "expected_revision"],
        ),
        _tool(
            "expire_work_item_request",
            "Withdraw a human request",
            "Explicitly withdraw a pending request, retaining its record. A request asked of a"
            " session, and a question with a purpose, are withdrawn only by the session that"
            " asked, from any of its agents; others are refused with not_asker. Withdrawing the"
            " question of review returns its item to ready, started as it was.",
            WRITES,
            {"id": _STR, "expected_revision": _EXPECTED_REVISION, "author": _AUTHOR},
            ["id", "expected_revision"],
        ),
    ]
)

TOOL_NAMES = frozenset(tool["name"] for tool in TOOLS)

#: Tools this vocabulary no longer publishes, each with the call that does its work.
#: A session started before they went still holds their schemas and calls them; the
#: surface answers such a call with a refusal that names the replacement, so the
#: agent corrects itself in one call. A refusal, not an alias: nothing here runs.
REMOVED_TOOLS: dict[str, str] = {
    "update_work_item": 'apply_work_item_changes with update: {"id": "MAIN-12",'
    ' "update": {"title": "…"}}',
    "transition_work_item": 'apply_work_item_changes with transition: {"id": "MAIN-12",'
    ' "transition": {"state": "done"}}',
    "set_work_item_checklist": 'apply_work_item_changes with checklist: {"id": "MAIN-12",'
    ' "checklist": ["first step", {"text": "second step", "done": true}]}',
    "tick_work_item_checklist_item": "apply_work_item_changes with checklist_ticks:"
    ' {"id": "MAIN-12", "checklist_ticks": [{"item_id": "…"}]}',
    "link_work_items": 'apply_work_item_changes with links: {"id": "MAIN-12",'
    ' "links": [{"other": "MAIN-14", "kind": "blocks"}]}',
    "attach_work_item_ref": 'apply_work_item_changes with refs: {"id": "MAIN-12",'
    ' "refs": [{"kind": "commit", "value": "…"}]}',
    "set_work_item_summary": 'apply_work_item_changes with summary: {"id": "MAIN-12",'
    ' "summary": {"done": "…", "next": "…"}}',
    "report_work_item": "apply_work_item_changes with summary, which records the outcome:"
    ' {"id": "MAIN-12", "summary": {"done": "…", "next": "…"}}',
    "select_work_item_summary": "apply_work_item_changes with summary, which records the"
    ' outcome: {"id": "MAIN-12", "summary": {"done": "…", "next": "…"}}',
    "comment_work_item": 'apply_work_item_changes with comment: {"id": "MAIN-12",'
    ' "comment": {"body": "…"}}',
    "resolve_work_item_comment": "apply_work_item_changes with resolutions:"
    ' {"id": "MAIN-12", "resolutions": [{"comment_id": 7, "resolution": "…"}]}',
    "decline_work_item_request": "expire_work_item_request, which withdraws a pending"
    ' question: {"id": "<request_id>", "expected_revision": 1}; the owner declines one in'
    " Valkama's interface",
}


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


#: Every field a full record carries: the card's, the parts' and those named off both,
#: which `read_model` keeps apart. What a write answers with beyond them is its own.
_RECORD_FIELDS = frozenset(read_model.CARD_FIELDS + read_model.PARTS + read_model.OFF_CARD)


def _as_card(conn: sqlite3.Connection, answer: dict) -> dict:
    """A write's answer with the item as its card, and what the write itself reports.

    The HTTP boundary answers a write with the full record, which grows with the
    item's history; an agent reads the card in its place, as `get_work_item` gives
    it by default, and the parts by name. Read after the write and inside its
    transaction, the card stands at the revision the write left. The keys a write
    adds beside the record — what it applied, started, requeued, released or merged,
    what the guards warned and a force overrode — stay as the write gave them.
    """

    card = _work_item(conn, {"id": answer["reference"]})
    return {**card, **{name: value for name, value in answer.items() if name not in _RECORD_FIELDS}}


def _acknowledged(
    path: str, acknowledge: acknowledgements.Acknowledge
) -> Callable[[sqlite3.Connection, Mapping[str, object]], object]:
    """A write that answers briefly unless the caller asks for the item's card.

    Both forms are cut from the full record the HTTP boundary returns, so the write
    itself is the same either way.
    """

    write = _post(path)

    def run(conn: sqlite3.Connection, arguments: Mapping[str, object]) -> object:
        verbose = _is_verbose(arguments)
        item = write(conn, {name: value for name, value in arguments.items() if name != "verbose"})
        if not isinstance(item, dict):
            return item
        if verbose:
            return _as_card(conn, item)
        return acknowledge(item, arguments)

    return run


def _with_similar(
    write: Callable[[sqlite3.Connection, Mapping[str, object]], object],
) -> Callable[[sqlite3.Connection, Mapping[str, object]], object]:
    """A creation that also names the open items reading most like the new one.

    Read after the write, so the links the same call made are known and left out
    (`words.similar`). The HTTP boundary answers without it: the hint is for an
    agent that has just filed an item and may have filed it twice. The item is found
    by its reference, which the acknowledgement and the card both carry; the card
    names no `work_item_id`.
    """

    def run(conn: sqlite3.Connection, arguments: Mapping[str, object]) -> object:
        answer = write(conn, arguments)
        if isinstance(answer, dict) and isinstance(answer.get("reference"), str):
            created = read_model.item_row(conn, answer["reference"])
            answer["similar"] = words.similar(conn, str(created["work_item_id"]))
        return answer

    return run


def _told(
    write: Callable[[sqlite3.Connection, Mapping[str, object]], object],
) -> Callable[[sqlite3.Connection, Mapping[str, object]], object]:
    """A write that also says what a person did on its item since an agent last wrote there.

    Read after the write and inside its transaction, leaving its own call out,
    which is what "before this write" has to mean: the write lock is held, so
    nothing a person commits can fall between what this answer tells and the
    boundary this write sets, and the item is the one the call recorded, whether
    the tool named it, named a request, or took it from the queue. A refused
    write answers with its refusal and moves nothing. The key is absent when
    there is nothing to tell.

    A claim says, beside it, the words a person left on a goal or stage over the
    work while nobody worked there, which the claim took (`waiting`).
    """

    def run(conn: sqlite3.Connection, arguments: Mapping[str, object]) -> object:
        answer = write(conn, arguments)
        own = calls.written(conn) if calls.from_agent() else None
        if own is None or not isinstance(answer, dict):
            return answer
        told: dict[str, object] = {}
        events = (
            person_events.since_last_agent_write(conn, own[1], own_call=own[0])
            if own[1] is not None
            else []
        )
        if events:
            shown = events[-person_events.MOST_SHOWN :]
            told["from_person"] = shown
            if len(events) > len(shown):
                told["from_person_omitted"] = len(events) - len(shown)
        left = waiting.delivered(conn, own[0])
        if left:
            told["waiting"] = left
        return {**answer, **told} if told else answer

    return run


def _rooted(
    write: Callable[[sqlite3.Connection, Mapping[str, object]], object],
    claims: Callable[[Mapping[str, object]], bool],
) -> Callable[[sqlite3.Connection, Mapping[str, object]], object]:
    """A write whose claim began or held the item answers with its `project_roots`.

    The roots are what the agent reads each project's instructions from before it
    edits there, and they are named where the claim is, short answer or verbose.
    The HTTP boundary answers without them: a browser does not edit a checkout.
    The item is found by its reference, which the acknowledgement and the card
    both carry; the card names no `work_item_id`.
    """

    def run(conn: sqlite3.Connection, arguments: Mapping[str, object]) -> object:
        answer = write(conn, arguments)
        if not claims(arguments) or not isinstance(answer, dict):
            return answer
        item = answer.get("work_item", answer)
        if not isinstance(item, dict) or not isinstance(item.get("reference"), str):
            return answer
        claimed = read_model.item_row(conn, item["reference"])
        return {
            **answer,
            "project_roots": item_projects.project_roots(conn, str(claimed["work_item_id"])),
        }

    return run


def _claim_asked(arguments: Mapping[str, object]) -> bool:
    """Whether a creation or a batch names `claim: true`, its one claim group."""

    return arguments.get("claim") is True


def _claim_ready(conn: sqlite3.Connection, arguments: Mapping[str, object]) -> object:
    """The item the queue handed over as its card: the agent needs the item it just took."""

    answer = _post("/api/planning/work-item/claim-ready")(conn, arguments)
    if isinstance(answer, dict) and isinstance(answer.get("work_item"), dict):
        return {**answer, "work_item": _as_card(conn, answer["work_item"])}
    return answer


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


#: The part each mode of get_work_item cuts, which a read naming no parts reads alone.
_MODE_PARTS = {
    "comments_after": "comments",
    "thread": "comments",
    "unresolved": "comments",
    "events": "events",
    "section": "sections",
}


def _work_item(conn: sqlite3.Connection, arguments: Mapping[str, object]) -> dict:
    """One item by parts: its card unless the caller names others or a mode.

    The boundary reads the parts, so a read over HTTP that names them answers the
    same. A mode without `parts` reads the part it cuts and nothing else.
    """

    modes = {
        "comments_after": arguments.get("comments_after"),
        "thread": arguments.get("thread"),
        "unresolved": _is_verbose(arguments, "unresolved") or None,
        "events": arguments.get("events"),
        "section": _section_keys(arguments.get("section")),
    }
    named = [_MODE_PARTS[mode] for mode, value in modes.items() if value is not None]
    # Each name is held to the parts before the list is joined, so a comma inside
    # one cannot make two of it.
    parameters = {
        "id": [str(arguments["id"])],
        "parts": [",".join(read_model.part_names(_part_names(arguments.get("parts"), named)))],
    }
    for mode, value in modes.items():
        if value is True:
            parameters[mode] = ["true"]
        elif mode == "events" and value is not None:
            parameters[mode] = [str(read_model.events_count(value))]
        elif isinstance(value, list):
            parameters[mode] = value
        elif value is not None:
            parameters[mode] = [str(model.count_field(value, mode))]
    answer = api.handle_get(conn, "/api/planning/work-item", parameters)
    if answer is None:  # pragma: no cover - the path table above is closed
        raise ValueError("no planning work item read")
    return answer[1]["work_item"]


def _section_keys(keys: object) -> list[str] | None:
    """`section` as a list of keys: one key or a list of them, or None when not named."""

    if keys is None:
        return None
    if isinstance(keys, str):
        return [keys]
    if isinstance(keys, list) and keys and all(isinstance(key, str) for key in keys):
        return keys
    raise model.PlanningError("section must be a section key or a list of them")


def _part_names(names: object, by_modes: list[str]) -> list[str]:
    """`parts` as a list of names: one name, a list of them, or what the modes read.

    Without `parts`, the parts the modes cut, or the card when no mode is named.
    """

    if names is None:
        return by_modes or ["card"]
    if isinstance(names, str):
        return [names]
    if isinstance(names, list) and names and all(isinstance(name, str) for name in names):
        return names
    raise model.PlanningError("parts must be a part name or a list of them")


def _image(conn: sqlite3.Connection, arguments: Mapping[str, object]) -> object:
    """One picture the item holds, for the surface to hand over as an image."""

    return images.read(conn, arguments.get("sha256"), item=arguments.get("id") or "")


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
        "state": item["state"]["key"] if item["state"] is not None else None,
        "priority": item["priority"],
        "parent": read_model.reference(conn, read_model.item_by_id(conn, parent))
        if parent
        else None,
        "claim_ref": item["claim_ref"],
        "claim_state": item["claim_state"],
    }
    # What an accepted open goal or stage derives, where it stands in no state.
    if item["container_state"] is not None:
        row["container_state"] = item["container_state"]
    # Its place in its space's queue, or why the queue does not give it; a search
    # row carries no place, since a place is the list's and not the item's.
    if item.get("queue_order") is not None:
        row["queue_order"] = item["queue_order"]
    if item["withheld"]:
        row["withheld"] = item["withheld"]
    # The space an item of another space lies in, where a space's list holds it.
    if item.get("other_space") is not None:
        row["other_space"] = item["other_space"]
    # Why a search returned the item; a row without it cannot be told from noise.
    hits = ("comment_hit", "question_hit", "summary_hit")
    return row | {name: item[name] for name in hits if name in item}


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
    on a reviewer, then work anyone could take now, then everything else, an
    accepted goal or stage among it: it is worked through what stands under it."""

    category = member["state"]["category"] if member["state"] is not None else None
    if category == "active":
        return 0
    if category == "review":
        return 1
    return 2 if member["workable"] else 3


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
    # The members come in the order of work; a stable sort keeps it inside each group.
    open_members = sorted((member for member in members if member["open"]), key=_open_rank)
    found["open_members"] = [
        {
            "reference": member["reference"],
            "title": member["title"],
            "state": member["state"]["key"] if member["state"] is not None else None,
            **(
                {"container_state": member["container_state"]}
                if member["container_state"] is not None
                else {}
            ),
            "claim_ref": member["claim_ref"],
            "claim_state": member["claim_state"],
            "workable": member["workable"],
            "parent_reference": member["parent_reference"],
            "queue_order": member["queue_order"],
        }
        for member in open_members[offset : offset + size]
    ]
    truncated = len(open_members) > offset + size
    found["truncated"] = truncated
    found["next_offset"] = offset + size if truncated else None
    return found


def _request_list(conn: sqlite3.Connection, arguments: Mapping[str, object]) -> object:
    """Questions as an agent scans them; the HTTP list a screen draws from stays whole."""

    parameters = {
        name: [str(arguments[name])]
        for name in ("space", "id", "status", "answered_after", "limit", "offset")
        if arguments.get(name) is not None
    }
    if arguments.get("addressed") is not None:
        parameters["addressed"] = ["true" if arguments["addressed"] is True else "false"]
    read = api.handle_get(conn, "/api/planning/requests", parameters)
    if read is None:  # pragma: no cover - the path table above is closed
        raise ValueError("no planning requests read")
    answer = read[1]
    if _is_verbose(arguments, "full"):
        return answer
    return {**answer, "requests": requests.compact_all(conn, answer["requests"])}


def _answer(conn: sqlite3.Connection, arguments: Mapping[str, object]) -> object:
    """An answer, or with `change` a change of one: the same body to two writes."""

    rest = {name: value for name, value in arguments.items() if name != "change"}
    if _is_verbose(arguments, "change"):
        return _post("/api/planning/request/change")(conn, rest)
    return _post("/api/planning/request/answer")(conn, rest)


def _spaces(conn: sqlite3.Connection, _arguments: Mapping[str, object]) -> object:
    """The spaces, and the calling session's among them: the one its folder stands in.

    Only a tool call has a session; the HTTP list a screen draws from has none.
    """

    read = api.handle_get(conn, "/api/planning/spaces", {})
    if read is None:  # pragma: no cover - the path table above is closed
        raise ValueError("no planning spaces read")
    session_space = item_projects.session_space(conn, calls.confirmed_session())
    return {**read[1], "session_space": session_space}


def _space(conn: sqlite3.Connection, arguments: Mapping[str, object]) -> object:
    (shown,) = item_projects.spaces_shown(
        conn, [service.get_planning_space(conn, str(arguments["space"]))]
    )
    return shown


OPS: dict[str, Callable[[sqlite3.Connection, Mapping[str, object]], object]] = {
    "list_planning_spaces": _spaces,
    "get_planning_space": _space,
    "create_planning_space": _post("/api/planning/spaces"),
    "create_work_item": _rooted(
        _with_similar(_acknowledged("/api/planning/work-items", acknowledgements.created)),
        _claim_asked,
    ),
    "get_work_item": _work_item,
    "read_work_item_image": _image,
    "list_work_items": _listing(
        _get(
            "/api/planning/work-items",
            "space",
            "state",
            "category",
            "kind",
            "owner",
            "parent",
            "project",
            "limit",
            "offset",
        )
    ),
    "get_work_item_chain": _chain,
    "search_work_items": _listing(_search),
    "claim_work_item": _rooted(
        _acknowledged("/api/planning/work-item/claim", acknowledgements.claimed),
        lambda arguments: arguments.get("release") is not True,
    ),
    "claim_ready_work_item": _rooted(_claim_ready, lambda _arguments: True),
    "claim_work_item_checklist_item": _acknowledged(
        "/api/planning/work-item/checklist/claim", acknowledgements.step_changed
    ),
    "merge_work_items": _acknowledged("/api/planning/work-item/merge", acknowledgements.merged),
    "apply_work_item_changes": _rooted(
        _acknowledged("/api/planning/work-item/apply", acknowledgements.applied), _claim_asked
    ),
    "delete_work_item": _post("/api/planning/work-item/delete"),
    "create_work_item_request": _post("/api/planning/work-item/request"),
    "get_work_item_request": _get("/api/planning/request", "id", unwrap="request"),
    "list_work_item_requests": _request_list,
    "answer_work_item_request": _answer,
    "expire_work_item_request": _post("/api/planning/request/expire"),
}
for _write_tool in TOOLS:
    # Every write that leaves its item standing: a deleted one has nobody to tell.
    if _write_tool["annotations"].get("destructiveHint") is False:
        OPS[_write_tool["name"]] = _told(OPS[_write_tool["name"]])
