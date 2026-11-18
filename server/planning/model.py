"""The vocabulary Planning is spelled in, and the readers that enforce it.

Planning is one module. Its states, its item kinds and its link kinds belong to
it, not to the product: the Kernel knows a `work-item` is an entity and nothing
more. What the Kernel does need is the *category* of a state, because Analytics
and the shared guards reason about "active" and "completed" without knowing
that this installation calls them Dev and Done.

Nothing here touches SQLite. The store spells its columns in these terms and
the service spells its refusals in them, which is what keeps one rejection from
being worded two ways.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Iterable, Mapping
from typing import NamedTuple
from uuid import UUID, uuid4

PLANNING_INTERFACE = "valkama-planning"
STORE_SCHEMA_MISMATCH = "store_schema_mismatch"

# A state's category, which is shared, and its name, which is not. Analytics
# counts an item in `active` without being told that Dev is what it is called.
#: The eight categories of the work model: what a caller names, what a tool lists
#: and what a refusal offers. In the order the default workflow places them.
PUBLIC_CATEGORIES = (
    "triage",
    "deferred",
    "ready",
    "active",
    "review",
    "completed",
    "blocked",
    "cancelled",
)
_PUBLIC_CATEGORY_SET = frozenset(PUBLIC_CATEGORIES)
#: The category of a workflow's one service state, where an accepted open container
#: stands. It is not a category of the model: an answer shows such a container by
#: what it derives, and no input names this word.
SERVICE_CATEGORY = "container"
#: What the store's CHECK takes, and nothing else reads: the eight and the service one.
STORED_CATEGORIES = (*PUBLIC_CATEGORIES, SERVICE_CATEGORY)
#: The categories a container never stands in: work in them has a holder or waits
#: on one, and a container is held by nobody.
TASK_ONLY_CATEGORIES = ("ready", "active", "review", "blocked")
#: Where accepted work stands: an item here has a basis, and the store refuses one
#: without. Cancelled work may have one or not: it was accepted or it was not.
ACCEPTED_CATEGORIES = ("ready", "active", "review", "blocked", "completed", SERVICE_CATEGORY)
#: Where entering takes the basis away: work there is not accepted.
UNACCEPTED_CATEGORIES = ("triage", "deferred")
#: The only categories a holder stands in: a task at work, or one blocked at it.
HELD_CATEGORIES = ("active", "blocked")
#: Entering one of these is a start, recorded once: completed work was done even
#: if nobody claimed it, and cancelled work was not.
STARTING_CATEGORIES = ("active", "review", "completed")
#: Where the take-next queue takes work from, and where an item may be `workable`:
#: work in triage or deferred is not accepted, so nobody is given it unasked.
WORKABLE_CATEGORIES = ("ready",)
#: Why nothing claims a goal or a stage, by any way in: work is held, a container is not.
CONTAINER_UNHELD = "a goal or stage has no holder; claim a task under it"

#: A container holds other work and is never worked itself. Outside the store it is
#: a goal, or a stage when it stands under a parent.
CONTAINER_KIND = "container"
#: The kinds a task can be edited between; a container is not one of them.
TASK_KINDS = frozenset({"task", "bug", "improvement"})
#: What `work_items.kind` holds.
WORK_ITEM_KINDS = TASK_KINDS | {CONTAINER_KIND}
#: What a caller names: a task kind, or a container as a goal or a stage.
PUBLIC_KINDS = ("task", "bug", "improvement", "goal", "stage")
_CONTAINER_WORDS = frozenset({"goal", "stage"})

#: Why accepted work was accepted: the basis an acceptance records. `agent` is an
#: agent's own decision where the owner's participation setting leaves it to the
#: agent, as for a goal it proposes. `migrated` is the work-model migration's alone:
#: no tool and no HTTP write takes it.
ACCEPTANCE_BASES = ("owner", "assignment", "inherited", "label_rule", "agent", "migrated")
#: How a project came to an item (`item_projects`), strongest first: named by whoever
#: filed or edited it, derived from its commits, or its space's former project.
PROJECT_SOURCES = ("named", "commits", "migrated")
#: When the tasks under a goal or stage were counted (`planning.baselines`): at its
#: acceptance, or when work under a goal or stage accepted empty first started.
BASELINE_BASES = ("accepted", "started")
#: Where an agent launched from a card works, a setting of its space: the root of the
#: space's default project, or the root of a project the card names. The first is
#: what every space starts with; only the owner's settings change it.
LAUNCH_PLACES = ("space", "item_project")
#: The one basis a caller names itself: an agent taking on work it was asked to do.
#: A person's write is the owner's without naming it, and the rest the server gives.
NAMED_BASIS = "assignment"
#: The basis of an agent's own decision, which the server gives where the owner's
#: participation setting leaves the decision to the agent.
AGENT_BASIS = "agent"


class RetiredWord(NamedTuple):
    """What the refusal of a word an input no longer takes says.

    `says` names what replaces the word, and is empty for a word whose refusal is
    the one any name the input does not know gets. `lists` is whether that refusal,
    which lists what the input does take, follows it.
    """

    says: str
    lists: bool


_RETIRED_STATE_WORDS = {
    "backlog": RetiredWord("backlog is now triage", lists=True),
    "queued": RetiredWord("queued is now ready", lists=True),
    "container": RetiredWord(
        "container is not a category: an accepted goal or stage shows container_state;"
        " accept one with ready",
        lists=False,
    ),
}
#: The words an input no longer takes, by the input that took them, each with what
#: its refusal says. A refusal, not a synonym: nothing reads one word as another,
#: and a refused input writes nothing. Every refusal of such a word, from a tool or
#: from HTTP, reads this one list.
RETIRED_WORDS: dict[str, dict[str, RetiredWord]] = {
    "kind": {
        "epic": RetiredWord(
            "kind epic is retired: a container is kind goal, or stage under a parent",
            lists=False,
        ),
    },
    "scope": {
        "epic": RetiredWord(
            "scope epic is retired: scope tree reads the item and everything under it",
            lists=False,
        ),
    },
    "category": _RETIRED_STATE_WORDS,
    # `todo` was a key and no workflow has it now: its refusal is the one any
    # unknown key gets, which lists the workflow's states.
    "state": {**_RETIRED_STATE_WORDS, "todo": RetiredWord("", lists=True)},
}
#: The fields an input no longer takes, each with what its refusal says. Like a
#: retired word, a refusal and not a synonym: the field is read for nothing, and the
#: write that names it is refused before anything is written. The tools' refusal of
#: an unknown argument and the HTTP refusal of an unknown field both read this list.
RETIRED_FIELDS: dict[str, str] = {
    "rank": "rank is retired: the order of work is computed — urgent, started, a goal or"
    " stage under way, priority, age",
}
PRIORITIES = ("low", "medium", "high", "urgent")
_PRIORITY_SET = frozenset(PRIORITIES)

#: The fields an edit changes, which the batch's `update` group takes and the HTTP
#: edit accepts. One that is absent or null changes nothing.
UPDATABLE_FIELDS = (
    "title",
    "description",
    "source",
    "priority",
    "labels",
    "labels_add",
    "labels_remove",
    "kind",
    "parent",
    "projects",
)


def retired_field(names: Iterable[str]) -> str | None:
    """What the refusal of the first retired field among `names` says, or None."""

    return next((RETIRED_FIELDS[name] for name in names if name in RETIRED_FIELDS), None)


def updated_fields(arguments: Mapping[str, object]) -> list[str]:
    """The fields an edit names, which is what its answer says it edited."""

    return [name for name in UPDATABLE_FIELDS if arguments.get(name) is not None]


# `blocks` and `discovered-from` are directed and carry the graph. `duplicates`
# is written by a merge from the duplicate to the item that survives it.
# `relates-to` reads the same from either end, so it is one record whichever end
# wrote it, and either end removes it; the store refuses the record's mirror.
LINK_KINDS = frozenset({"blocks", "relates-to", "discovered-from", "duplicates"})
SYMMETRIC_LINK_KINDS = frozenset({"relates-to"})

#: A commit is no ref: it is attached (`planning.commits`) and read as the item's `commits`.
REF_KINDS = frozenset({"session", "memory", "url"})
#: What a ref of the kind `commit` is refused with: where a commit goes instead.
COMMIT_REF_HINT = "commits are attached with the commits group"

# Every audited action, in one tuple, because the schema's CHECK and the code
# that writes it drifted apart once already in the Board era.
EVENT_ACTIONS = (
    "created",
    "transitioned",
    "claimed",
    "released",
    "taken_over",
    "linked",
    "unlinked",
    "checklist_replaced",
    "checklist_claimed",
    "checklist_taken_over",
    "checklist_released",
    "checklist_completed",
    "checklist_reopened",
    "summarized",
    "execution_attached",
    "overridden",
    "request_created",
    "request_answered",
    "request_declined",
    "request_expired",
    # Schema 10: a thread's root marked resolved or opened again, and an answer
    # replaced by a newer one.
    "comment_resolved",
    "comment_reopened",
    "request_changed",
    # Schema 12: a comment on another item named this one, the comment's id as the
    # detail.
    "mentioned",
    # Schema 15: an edit changed the item's set of labels, the set before and the
    # set after as the detail (`labels_change`).
    "labels_changed",
    # Schema 18: an item accepted, its basis as the detail; a container that came
    # to stand in the service state, a reason or nothing as the detail and never a
    # state's key; a child that left this container, the child's reference.
    "accepted",
    "opened",
    "child_left",
    # A goal or stage that came to await confirmation, recorded by Valkama in a call
    # of its own: what was cancelled and moved out under it as the detail.
    "awaiting_confirmation",
    # Put-off work that came back, recorded by Valkama beside the move that returned
    # it, in the same call: why, as `date 2026-12-01` or `completed MAIN-12`.
    "returned",
    # A task made a goal or stage, or one made a task again, by the call that converted
    # it: `task -> stage`, then `; leftover MAIN-15: 2 steps` and `; projects dropped: …`
    # when so.
    "converted",
    # A step a checklist edit left out, or the text a step repeated by its id with
    # another text had: that text's first 120 characters.
    "checklist_removed",
    # A part split off a task, by the call that split it: on the task the part and how
    # many steps it took, `MAIN-15: 2 steps`, and on the part the task's reference.
    "split_off",
    "split_from",
    # An action that waited for the owner and was dropped without being carried out
    # (`planning.pending`): `<point>: <why>`, such as `proposed_goal: merged into MAIN-12`.
    "action_dropped",
    # A commit attached to the item or detached from it, `<project_id> <hash>` as the
    # detail, and an attachment a rewrite carried to the new commit, `<project_id>
    # <old> -> <new>`. No schema raise: the open widens the CHECK (`widen_event_actions`).
    "commit_attached",
    "commit_detached",
    "commit_rewritten",
)
_EVENT_ACTION_SET = frozenset(EVENT_ACTIONS)
#: The actions that say which state an item came to stand in: `created` and
#: `transitioned` by the key of a category's state, `opened` by its own name alone.
STATE_ENTRY_ACTIONS = ("created", "transitioned", "opened")

_SPACE_KEY = re.compile(r"^[A-Z][A-Z0-9]{1,7}$")
# Characters only: each caller's `limit` owns the length, so a step of up to
# 1000 characters is not refused here as if it held a control character.
_SAFE_TEXT = re.compile(r"^[^\x00\r\n]*$")
#: The grammar of a work item reference, unanchored, for a scanner to embed.
HUMAN_ID_SHAPE = r"([A-Z][A-Z0-9]{1,7})-([1-9][0-9]{0,8})"
_HUMAN_ID = re.compile(rf"^{HUMAN_ID_SHAPE}$")
_ITEM_NUMBER = re.compile(r"^[1-9][0-9]{0,8}$")

MAX_TITLE = 200
MAX_DESCRIPTION = 20_000
MAX_LABELS = 32
MAX_LABEL_LENGTH = 64
MAX_CHECKLIST = 100
# A step is a sentence, not a title. The store this migrates from holds one
# of 213 characters, so borrowing the title's limit refused real work.
MAX_CHECKLIST_TEXT = 1000
#: The step field that marks a tick made by a holder whose lease lapsed.
PREVIOUS_HOLDER = "by_previous_holder"


class PlanningError(ValueError):
    """A refusal a caller can act on, worded once."""


class WorkItemNotFoundError(PlanningError):
    """The caller named a work item, by reference or id, and no item answers to it.

    Its own code rather than `invalid_request`: the request was well formed, the
    item is simply not there, and a caller -- the web card, the graph's chain, an
    agent -- says something different to a person about each.
    """


class StoreSchemaError(PlanningError):
    """A store this build reads as it is cannot answer: it lacks what the read names.

    An attached store is never migrated, so one another build wrote may hold no
    such table or column. Its own code, so a reader can say that instead of
    reporting a failure, and it carries none of the store's own words.
    """


class WorkflowGuardError(PlanningError):
    """A transition the workflow does not permit, or permits only with force."""


class CancelListError(WorkflowGuardError):
    """A goal or stage cancelled with open work under it, without the list's token or with
    a stale one: the refusal carries the list of what the cancel would close.

    Its own code and body (`api.error_response`): the caller reads `cancels`, what would
    be cancelled, and `dependents`, the open work outside that waits on it, and sends the
    same move with `cancels` set to `list_token` to cancel it all.
    """

    def __init__(
        self, message: str, cancels: list[dict], dependents: list[dict], list_token: str
    ) -> None:
        super().__init__(message)
        self.cancels = cancels
        self.dependents = dependents
        self.list_token = list_token


class MentionLimitError(PlanningError):
    """A session named one item in `mentions` as often as an hour allows.

    Its own code: the request is well formed and would be accepted later, or as
    one comment on that item instead.
    """


class AskLimitError(PlanningError):
    """A session asked one other session as often as an hour allows.

    Its own code, as `MentionLimitError` has: the request is well formed and would be
    accepted later, or asked once with every field it needs.
    """


class NotAddressedError(PlanningError):
    """A request asked of an agent session, answered or declined by any other caller.

    Its own code: the request is fine and so is the answer; only that session,
    from its conversation or a subagent, may give it.
    """


class NotAskerError(PlanningError):
    """A request asked of an agent session, withdrawn by neither the session that asked
    nor Valkama; or a question with a purpose withdrawn by any session but the one that
    asked it."""


class OwnerOnlyError(PlanningError):
    """A question with a purpose, answered by anyone but the owner in Valkama.

    Its own code: the answer may be right, but it decides what the owner decides —
    accepting work, confirming a goal, taking up work that came back.
    """


class QueueOffError(PlanningError):
    """The queue of a space whose owner hands out work by hand, asked for its next task.

    Its own code: the call is well formed and nothing is wrong with the work; the
    owner names the item, and it is taken by its number instead.
    """


class RevisionConflictError(PlanningError):
    """Someone else wrote this item since the caller read it."""

    def __init__(self, expected: int, actual: int) -> None:
        super().__init__(f"work item is at revision {actual}, not {expected}")
        self.expected = expected
        self.actual = actual


def container_unheld() -> WorkflowGuardError:
    """The one refusal of a claim on a goal or stage, by whatever way in it came."""

    return WorkflowGuardError(f"[goal_or_stage] {CONTAINER_UNHELD}")


def new_id() -> str:
    return str(uuid4())


def identifier(value: object, field: str) -> str:
    """A UUID this module minted, refused as text rather than coerced."""

    text = text_field(value, field, limit=36)
    try:
        parsed = UUID(text)
    except ValueError as error:
        raise PlanningError(f"{field} must be a UUID") from error
    if str(parsed) != text:
        raise PlanningError(f"{field} must be a canonical lowercase UUID")
    return text


def text_field(value: object, field: str, *, limit: int = MAX_TITLE, required: bool = True) -> str:
    if not isinstance(value, str):
        raise PlanningError(f"{field} must be a string")
    text = value.strip()
    if required and not text:
        raise PlanningError(f"{field} is required")
    if len(text) > limit:
        raise PlanningError(f"{field} must be at most {limit} characters")
    if not _SAFE_TEXT.match(text.replace("\n", "")):
        raise PlanningError(f"{field} must not contain control characters")
    return text


def multiline_field(value: object, field: str, *, limit: int = MAX_DESCRIPTION) -> str:
    if not isinstance(value, str):
        raise PlanningError(f"{field} must be a string")
    if len(value) > limit:
        raise PlanningError(f"{field} must be at most {limit} characters")
    if "\x00" in value:
        raise PlanningError(f"{field} must not contain a NUL byte")
    return value.strip()


#: The largest integer SQLite binds; a larger one is an error it cannot answer.
MAX_COUNT = 2**63 - 1


def count_field(value: object, field: str) -> int:
    """A count of things, such as where a page starts: an integer, never negative.

    A boolean is refused although Python calls it an integer, because `true`
    sent as an offset is a caller's mistake, not the number one.
    """

    if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= MAX_COUNT:
        raise PlanningError(f"{field} must be a non-negative integer")
    return value


def enum_field(value: object, allowed: frozenset[str], field: str) -> str:
    if not isinstance(value, str) or value not in allowed:
        raise PlanningError(f"{field} must be one of {', '.join(sorted(allowed))}")
    return value


def space_key(value: object) -> str:
    """The prefix a human identifier is built from, such as `MAIN`."""

    text = text_field(value, "planning_space.key", limit=8)
    if not _SPACE_KEY.match(text):
        raise PlanningError("planning_space.key must be 2 to 8 uppercase letters or digits")
    return text


def derive_space_key(name: str, taken: frozenset[str]) -> str:
    """A key from a space's name, and a number only when the letters cannot be the key.

    `Beta Garden` becomes `BG`, `Valkama` becomes `VAL`. A second space whose
    name derives to the same letters gets `BG2`, because the key is what every
    human identifier in that space is built from and it cannot be shared. A name
    of one letter gets a number too: `S` becomes `S2`, because a key has at least
    two characters and a reference built from one could never be read back.
    """

    words = [word for word in re.split(r"[^A-Za-z0-9]+", name) if word]
    if not words:
        raise PlanningError("planning space name has no letters to build a key from")
    if len(words) == 1:
        base = words[0][:3].upper()
    else:
        base = "".join(word[0] for word in words)[:4].upper()
    base = re.sub(r"[^A-Z0-9]", "", base) or "SPC"
    if not base[0].isalpha():
        base = f"S{base}"[:8]
    if len(base) > 1 and base not in taken:
        return base
    for suffix in range(2, 1000):
        candidate = f"{base[: 8 - len(str(suffix))]}{suffix}"
        if candidate not in taken:
            return candidate
    raise PlanningError("no free planning space key remains for this name")


def refuse_retired(field: str, value: object, unknown: Callable[[], str] | None = None) -> None:
    """Refuse a word `field` no longer takes, naming what replaces it.

    `unknown` gives the refusal a name the input does not know gets, which lists
    what it takes; a retired word whose refusal lists it is refused with that after
    its own words.
    """

    if not isinstance(value, str):
        return
    retired = RETIRED_WORDS[field].get(value.strip())
    if retired is None:
        return
    told = [retired.says] if retired.says else []
    if retired.lists and unknown is not None:
        told.append(unknown())
    raise PlanningError("; ".join(told))


def state_category(value: object) -> str:
    """One of the eight categories a caller names; a retired one is refused with its replacement."""

    refuse_retired("category", value, lambda: f"the categories are {', '.join(PUBLIC_CATEGORIES)}")
    return enum_field(value, _PUBLIC_CATEGORY_SET, "workflow_state.category")


def priority(value: object) -> str:
    return enum_field(value, _PRIORITY_SET, "work_item.priority")


def named_basis(value: object) -> str | None:
    """The basis a caller names for the work it accepts, or None when it names none."""

    if value is None or value == "":
        return None
    if value != NAMED_BASIS:
        raise PlanningError(
            f"acceptance takes {NAMED_BASIS} alone: the owner accepts by their own write,"
            " and the server gives the rest"
        )
    return NAMED_BASIS


def public_kind(value: object) -> str:
    """The kind a caller named, as it named it: a task kind, `goal` or `stage`."""

    refuse_retired("kind", value)
    return enum_field(value, frozenset(PUBLIC_KINDS), "work_item.kind")


def work_item_kind(value: object) -> str:
    """The kind the store holds for the one a caller named: a goal or a stage is a container."""

    kind = public_kind(value)
    return CONTAINER_KIND if kind in _CONTAINER_WORDS else kind


def link_kind(value: object) -> str:
    return enum_field(value, LINK_KINDS, "work_item_link.kind")


def ref_kind(value: object) -> str:
    try:
        return enum_field(value, REF_KINDS, "work_item_ref.kind")
    except PlanningError as error:
        if value == "commit":
            raise PlanningError(f"{error}: {COMMIT_REF_HINT}") from None
        raise


def event_action(value: object) -> str:
    return enum_field(value, _EVENT_ACTION_SET, "work_item_event.action")


def actor(value: object, field: str = "author") -> str:
    """Who did it, as the name they recorded. Absent means the product itself.

    Bounded text rather than an identifier, because that is what this is. The
    store the migration reads holds `Codex /root`, `claude-opus5 (session
    5937332f)` and a Russian session label, all written by agents that had every
    right to name themselves that way. Refusing them would have refused history
    to buy a pattern nothing needs: nothing resolves this field, and the layer
    that introduces real execution identity introduces the ref for it too.
    """

    if value is None or value == "":
        return "agent"
    return text_field(value, field, limit=128)


def labels(value: object, field: str = "work_item.labels") -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise PlanningError(f"{field} must be a list of strings")
    if len(value) > MAX_LABELS:
        raise PlanningError(f"{field} must hold at most {MAX_LABELS} entries")
    seen: list[str] = []
    for index, item in enumerate(value):
        label = text_field(item, f"{field}[{index}]", limit=MAX_LABEL_LENGTH)
        if label not in seen:
            seen.append(label)
    return seen


def edited_labels(
    current: list[str], replaced: object, added: object, removed: object
) -> list[str] | None:
    """The labels an edit leaves, or None when it names none of the three fields.

    `labels` replaces the whole set; `labels_add` and `labels_remove` change the
    set the item has, so a caller that means to add one label need not know the
    rest. A label already there is not added twice and one that is absent is not
    removed; the result is held to the same limits as a whole set. `labels` beside
    either of the other two is refused, because a replacement and a change of the
    set it replaces say two different things and no order between them is the one
    the caller meant. A label named both to add and to remove is refused for the
    same reason.
    """

    if added is None and removed is None:
        return None if replaced is None else labels(replaced)
    if replaced is not None:
        raise PlanningError(
            "labels replaces the whole set and labels_add or labels_remove changes it;"
            " send one or the other"
        )
    adding = labels(added, "labels_add")
    removing = labels(removed, "labels_remove")
    both = [label for label in adding if label in removing]
    if both:
        raise PlanningError(f"{both[0]!r} is named in both labels_add and labels_remove")
    kept = [label for label in current if label not in removing]
    return labels(kept + [label for label in adding if label not in kept])


def outward_kind(kind: object, parent_id: object) -> str:
    """The kind a reader sees: a container is a goal, or a stage under a parent.

    Every place a kind leaves the server from a row reads it through this.
    """

    if kind == CONTAINER_KIND:
        return "stage" if parent_id else "goal"
    return str(kind)


def human_id(key: str, number: int) -> str:
    """`MAIN-142`: what a person types, built from the space key and the number."""

    if number < 1:
        raise PlanningError("work_item.number starts at 1")
    return f"{key}-{number}"


def parse_human_id(value: object) -> tuple[str, int]:
    text = text_field(value, "work_item reference", limit=20)
    match = _HUMAN_ID.match(text)
    if match is None:
        raise PlanningError("a work item reference reads as KEY-NUMBER, such as MAIN-142")
    return match.group(1), int(match.group(2))


def exact_reference(query: str) -> str | None:
    """The reference a search query names exactly, such as `MAIN-12`, or None.

    A person types `main-12` as readily as `MAIN-12`, and pastes it with a space
    around it; both name the same item, so a search ranks that item first.
    """

    match = _HUMAN_ID.match(query.strip().upper())
    return None if match is None else human_id(match.group(1), int(match.group(2)))


def exact_number(query: str) -> int | None:
    """The item number a search query is by itself, such as `12`, or None.

    An editor's `#12` asks its space's search for `12`, and a person types the
    number alone into a search scoped to a space: both mean the item numbered
    12 there, while MAIN-120 and every mention of 12 match the same text. Read
    across spaces, the number names each space's item of that number.
    """

    text = query.strip()
    return int(text) if _ITEM_NUMBER.match(text) else None


def names_exactly(query: str, reference: str) -> bool:
    """Whether a search query names this reference itself: whole, or by number."""

    exact = exact_reference(query)
    if exact is not None:
        return reference == exact
    number = exact_number(query)
    return number is not None and reference.endswith(f"-{number}")


def checklist(value: object) -> list[dict]:
    """The steps of one item, each with the id that lets two agents split it.

    `by_previous_holder` says the step's tick was made by a holder whose lease
    lapsed, and waits for a tick that confirms it; a step stored without it reads
    false.
    """

    if value is None:
        return []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as error:
            raise PlanningError("work_item.checklist is not valid JSON") from error
    if not isinstance(value, list):
        raise PlanningError("work_item.checklist must be a list")
    if len(value) > MAX_CHECKLIST:
        raise PlanningError(f"work_item.checklist must hold at most {MAX_CHECKLIST} steps")
    items: list[dict] = []
    seen_ids: set[str] = set()
    for index, raw in enumerate(value):
        where = f"work_item.checklist[{index}]"
        if isinstance(raw, str):
            items.append(new_checklist_item(raw))
            seen_ids.add(items[-1]["id"])
            continue
        if not isinstance(raw, dict):
            raise PlanningError(f"{where} must be a string or an object")
        unknown = set(raw) - {"id", "text", "done", "claimed_by", "done_by", PREVIOUS_HOLDER}
        if unknown:
            raise PlanningError(f"{where} has unknown field(s): {', '.join(sorted(unknown))}")
        item_id = identifier(raw.get("id") or new_id(), f"{where}.id")
        if item_id in seen_ids:
            raise PlanningError(f"{where}.id repeats within one checklist")
        seen_ids.add(item_id)
        done = raw.get("done", False)
        if not isinstance(done, bool):
            raise PlanningError(f"{where}.done must be a boolean")
        flagged = raw.get(PREVIOUS_HOLDER, False)
        if not isinstance(flagged, bool):
            raise PlanningError(f"{where}.{PREVIOUS_HOLDER} must be a boolean")
        items.append(
            {
                "id": item_id,
                "text": text_field(raw.get("text"), f"{where}.text", limit=MAX_CHECKLIST_TEXT),
                "done": done,
                "claimed_by": actor(raw.get("claimed_by") or "", f"{where}.claimed_by")
                if raw.get("claimed_by")
                else "",
                "done_by": actor(raw.get("done_by") or "", f"{where}.done_by")
                if raw.get("done_by")
                else "",
                PREVIOUS_HOLDER: flagged,
            }
        )
    return items


def new_checklist_item(text: object) -> dict:
    return {
        "id": new_id(),
        "text": text_field(text, "work_item.checklist[].text", limit=MAX_CHECKLIST_TEXT),
        "done": False,
        "claimed_by": "",
        "done_by": "",
        PREVIOUS_HOLDER: False,
    }


#: The longest each field of a summary may be.
SUMMARY_LIMIT = 4000


def summary(value: object, *, required: bool = True) -> dict | None:
    """What was done, why when the choice is not obvious, and what comes next.

    `friction` is what got in the way of the work itself, apart from the result:
    `none`, or a line per hindrance. It is kept as given, `none` included.
    """

    if value in (None, "", {}):
        if required:
            raise PlanningError("a summary states what was done and what comes next")
        return None
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as error:
            raise PlanningError("work_item.summary is not valid JSON") from error
    if not isinstance(value, dict):
        raise PlanningError("work_item.summary must be an object")
    unknown = set(value) - {"done", "why", "next", "friction"}
    if unknown:
        raise PlanningError(f"work_item.summary has unknown field(s): {', '.join(sorted(unknown))}")
    record = {
        "done": multiline_field(value.get("done"), "work_item.summary.done", limit=SUMMARY_LIMIT),
        "next": multiline_field(value.get("next"), "work_item.summary.next", limit=SUMMARY_LIMIT),
    }
    if not record["done"] or not record["next"]:
        raise PlanningError("a summary states what was done and what comes next")
    why = value.get("why")
    if why:
        record["why"] = multiline_field(why, "work_item.summary.why", limit=SUMMARY_LIMIT)
    friction = value.get("friction")
    if friction is not None:
        text = multiline_field(friction, "work_item.summary.friction", limit=SUMMARY_LIMIT)
        if text:
            record["friction"] = text
    return record


def dumps(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def labels_change(before: list[str], after: list[str] | None) -> str | None:
    """A `labels_changed` event's detail, or None when an edit leaves the set as it was.

    The detail is `{"from":[...],"to":[...]}`: the labels the item had and the
    labels it has, each in the order the item holds them. JSON rather than a line,
    because a label may hold a comma, a space or a colon. A set only reordered is
    the same set and records nothing, as does an edit that names no labels.
    """

    if after is None or set(before) == set(after):
        return None
    return dumps({"from": before, "to": after})


#: The longest detail `labels_change` writes: both sets full, each label at its length
#: and every character one JSON writes as a six-character escape (`\u0001`). Over the
#: limit of a detail a caller writes, which a full set of long labels would break.
_LONGEST_SET = ["\x01" * MAX_LABEL_LENGTH] * MAX_LABELS
LABELS_DETAIL_LIMIT = len(dumps({"from": _LONGEST_SET, "to": _LONGEST_SET}))


# The workflow a new PlanningSpace gets: one state for each of the eight categories,
# in this order, then the service state. `dev` and `done` keep the keys agents name
# in every close. Cancelled is there so that work closed as not needed, duplicated
# or superseded is not counted as done. The code below reads the table rather than
# this tuple: a space may be given a different set without anything else changing.
DEFAULT_WORKFLOW_NAME = "Delivery"
DEFAULT_STATES = (
    ("triage", "Triage", "triage"),
    ("deferred", "Deferred", "deferred"),
    ("ready", "Ready", "ready"),
    ("dev", "Dev", "active"),
    ("review", "Review", "review"),
    ("done", "Done", "completed"),
    ("blocked", "Blocked", "blocked"),
    ("cancelled", "Cancelled", "cancelled"),
    ("container", "Accepted", SERVICE_CATEGORY),
)
#: The categories of a state work is over in.
TERMINAL_CATEGORIES = frozenset({"completed", "cancelled"})
