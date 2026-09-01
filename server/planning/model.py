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
from uuid import UUID, uuid4

PLANNING_INTERFACE = "valkama-planning"

# A state's category, which is shared, and its name, which is not. Analytics
# counts an item in `active` without being told that Dev is what it is called.
STATE_CATEGORIES = (
    "backlog",
    "queued",
    "active",
    "review",
    "completed",
    "blocked",
    "cancelled",
)
_STATE_CATEGORY_SET = frozenset(STATE_CATEGORIES)

WORK_ITEM_KINDS = frozenset({"task", "epic", "bug", "improvement"})
PRIORITIES = ("low", "medium", "high", "urgent")
_PRIORITY_SET = frozenset(PRIORITIES)

# `blocks` and `discovered-from` are directed and carry the graph. `relates-to`
# and `duplicates` are symmetric in meaning but stored once, from the item the
# author was looking at.
LINK_KINDS = frozenset({"blocks", "relates-to", "discovered-from", "duplicates"})

REF_KINDS = frozenset({"session", "commit", "memory", "url"})

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
)
_EVENT_ACTION_SET = frozenset(EVENT_ACTIONS)

_SPACE_KEY = re.compile(r"^[A-Z][A-Z0-9]{1,7}$")
_STATE_KEY = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
_SAFE_TEXT = re.compile(r"^[^\x00\r\n]{0,512}$")
_HUMAN_ID = re.compile(r"^([A-Z][A-Z0-9]{1,7})-([1-9][0-9]{0,8})$")

MAX_TITLE = 200
MAX_DESCRIPTION = 20_000
MAX_LABELS = 32
MAX_CHECKLIST = 100
# A step is a sentence, not a title. The store this migrates from holds one
# of 213 characters, so borrowing the title's limit refused real work.
MAX_CHECKLIST_TEXT = 1000


class PlanningError(ValueError):
    """A refusal a caller can act on, worded once."""


class WorkflowGuardError(PlanningError):
    """A transition the workflow does not permit, or permits only with force."""


class RevisionConflictError(PlanningError):
    """Someone else wrote this item since the caller read it."""

    def __init__(self, expected: int, actual: int) -> None:
        super().__init__(f"work item is at revision {actual}, not {expected}")
        self.expected = expected
        self.actual = actual


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


def enum_field(value: object, allowed: frozenset[str], field: str) -> str:
    if not isinstance(value, str) or value not in allowed:
        raise PlanningError(f"{field} must be one of {', '.join(sorted(allowed))}")
    return value


def space_key(value: object) -> str:
    """The prefix a human identifier is built from, such as `VAL`."""

    text = text_field(value, "planning_space.key", limit=8)
    if not _SPACE_KEY.match(text):
        raise PlanningError("planning_space.key must be 2 to 8 uppercase letters or digits")
    return text


def derive_space_key(name: str, taken: frozenset[str]) -> str:
    """A key from a space's name, and a number only when the name collides.

    `Alpha Workspace` becomes `AW`, `Valkama` becomes `VAL`. A second space whose
    name derives to the same letters gets `AW2`, because the key is what every
    human identifier in that space is built from and it cannot be shared.
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
    if base not in taken:
        return base
    for suffix in range(2, 1000):
        candidate = f"{base[: 8 - len(str(suffix))]}{suffix}"
        if candidate not in taken:
            return candidate
    raise PlanningError("no free planning space key remains for this name")


def state_key(value: object) -> str:
    text = text_field(value, "workflow_state.key", limit=32)
    if not _STATE_KEY.match(text):
        raise PlanningError("workflow_state.key must be lowercase letters, digits or dashes")
    return text


def state_category(value: object) -> str:
    return enum_field(value, _STATE_CATEGORY_SET, "workflow_state.category")


def priority(value: object) -> str:
    return enum_field(value, _PRIORITY_SET, "work_item.priority")


def work_item_kind(value: object) -> str:
    return enum_field(value, WORK_ITEM_KINDS, "work_item.kind")


def link_kind(value: object) -> str:
    return enum_field(value, LINK_KINDS, "work_item_link.kind")


def ref_kind(value: object) -> str:
    return enum_field(value, REF_KINDS, "work_item_ref.kind")


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


def labels(value: object) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise PlanningError("work_item.labels must be a list of strings")
    if len(value) > MAX_LABELS:
        raise PlanningError(f"work_item.labels must hold at most {MAX_LABELS} entries")
    seen: list[str] = []
    for index, item in enumerate(value):
        label = text_field(item, f"work_item.labels[{index}]", limit=64)
        if label not in seen:
            seen.append(label)
    return seen


def human_id(key: str, number: int) -> str:
    """`VAL-142`: what a person types, built from the space key and the number."""

    if number < 1:
        raise PlanningError("work_item.number starts at 1")
    return f"{key}-{number}"


def parse_human_id(value: object) -> tuple[str, int]:
    text = text_field(value, "work_item reference", limit=20)
    match = _HUMAN_ID.match(text)
    if match is None:
        raise PlanningError("a work item reference reads as KEY-NUMBER, such as VAL-142")
    return match.group(1), int(match.group(2))


def checklist(value: object) -> list[dict]:
    """The steps of one item, each with the id that lets two agents split it."""

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
        unknown = set(raw) - {"id", "text", "done", "claimed_by", "done_by"}
        if unknown:
            raise PlanningError(f"{where} has unknown field(s): {', '.join(sorted(unknown))}")
        item_id = identifier(raw.get("id") or new_id(), f"{where}.id")
        if item_id in seen_ids:
            raise PlanningError(f"{where}.id repeats within one checklist")
        seen_ids.add(item_id)
        done = raw.get("done", False)
        if not isinstance(done, bool):
            raise PlanningError(f"{where}.done must be a boolean")
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
    }


def summary(value: object, *, required: bool = True) -> dict | None:
    """What was done, why when the choice is not obvious, and what comes next."""

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
    unknown = set(value) - {"done", "why", "next"}
    if unknown:
        raise PlanningError(f"work_item.summary has unknown field(s): {', '.join(sorted(unknown))}")
    record = {
        "done": multiline_field(value.get("done"), "work_item.summary.done", limit=4000),
        "next": multiline_field(value.get("next"), "work_item.summary.next", limit=4000),
    }
    if not record["done"] or not record["next"]:
        raise PlanningError("a summary states what was done and what comes next")
    why = value.get("why")
    if why:
        record["why"] = multiline_field(why, "work_item.summary.why", limit=4000)
    return record


def dumps(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


# The workflow a new PlanningSpace gets. Six states because that is what this
# installation's history holds, and the code below reads the table rather than
# this tuple: a space may be given a different set without anything else
# changing.
DEFAULT_WORKFLOW_NAME = "Delivery"
DEFAULT_STATES = (
    ("backlog", "Backlog", "backlog"),
    ("todo", "Todo", "queued"),
    ("dev", "Dev", "active"),
    ("review", "Review", "review"),
    ("done", "Done", "completed"),
    ("blocked", "Blocked", "blocked"),
)
