"""Strict typed question fields and answers, independent of storage."""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime

from . import model

STATUSES = frozenset({"pending", "answered", "declined", "expired"})
MAX_NOTE = 8000
MAX_OPTION_DESCRIPTION = 8000
#: A question's fields as stored. A description may run to 8000 characters on each
#: of 20 options of 12 fields, and that is not a question anyone can read.
MAX_FIELDS_BYTES = 64 * 1024
#: Where the parts of an answer beside the fields sit in `answers_json`: the
#: comment on the whole question, the own variant of each field and the comment on
#: each field. A field id starts with a letter, so no field can be called any of
#: these and an answer cannot be mistaken for one of them.
NOTE_KEY = "_note"
OWN_KEY = "_own"
NOTES_KEY = "_notes"
#: An own variant replaces the field's answer, so it may run as long as a written
#: one; a comment on a field sits beside the answer and is shorter.
MAX_OWN = 8000
MAX_FIELD_NOTE = 2000
#: How many versions one answer may have: the first and 49 changes.
MAX_ANSWER_VERSIONS = 50
#: The fields a person picks from. Only these take an own variant or a comment:
#: a text field is already the person's own words.
_PICKED = frozenset({"choice", "multi_choice", "boolean"})
#: The fields with one answer, which an own variant takes the place of; a
#: multi_choice field takes it beside the options chosen.
_SINGLE = frozenset({"choice", "boolean"})
#: How much of the prompt the compact form of a question quotes.
QUESTION_PREVIEW = 160
#: How much of a note or a written answer the compact form quotes, and how large one
#: compact question may be as JSON. An agent pulls answers often, so what a person
#: wrote at length stays one `get_work_item_request` away.
MAX_COMPACT_TEXT = 500
MAX_COMPACT_JSON = 2000
_KEY = re.compile(r"[a-z][a-z0-9_-]{0,63}\Z")
_OPTION_KEYS = frozenset({"id", "label", "description", "recommended"})


def key(value: object) -> str:
    if not isinstance(value, str) or not _KEY.fullmatch(value):
        raise model.PlanningError("field and option ids must be stable lowercase identifiers")
    return value


def fields(value: object) -> list[dict]:
    if not isinstance(value, list) or not 1 <= len(value) <= 12:
        raise model.PlanningError("fields must contain between 1 and 12 fields")
    result: list[dict] = []
    seen: set[str] = set()
    for raw in value:
        if not isinstance(raw, dict) or set(raw) != {"id", "label", "type", "required", "options"}:
            raise model.PlanningError("each field requires id, label, type, required and options")
        identity = key(raw["id"])
        if identity in seen:
            raise model.PlanningError("field ids must be unique")
        seen.add(identity)
        kind = model.enum_field(
            raw["type"], frozenset({"text", "choice", "multi_choice", "boolean"}), "field.type"
        )
        if not isinstance(raw["required"], bool):
            raise model.PlanningError("field.required must be boolean")
        options = raw["options"]
        if not isinstance(options, list) or len(options) > 20:
            raise model.PlanningError("field.options must be an array of at most 20 options")
        if bool(options) != (kind in {"choice", "multi_choice"}):
            raise model.PlanningError(
                "choice fields require options; other fields require no options"
            )
        parsed: list[dict] = []
        option_ids: set[str] = set()
        for option in options:
            shaped = _option(option)
            if shaped["id"] in option_ids:
                raise model.PlanningError("option ids must be unique")
            option_ids.add(shaped["id"])
            parsed.append(shaped)
        if kind == "choice" and sum(1 for option in parsed if option.get("recommended")) > 1:
            raise model.PlanningError("a choice field recommends at most one option")
        result.append(
            {
                "id": identity,
                "label": model.text_field(raw["label"], "field.label", limit=200),
                "type": kind,
                "required": raw["required"],
                "options": parsed,
            }
        )
    if len(model.dumps(result).encode("utf-8")) > MAX_FIELDS_BYTES:
        raise model.PlanningError("the fields of one question must fit in 64 KiB as stored")
    return result


def _option(raw: object) -> dict:
    """One choice: its id and label, and the two things it says only when given."""

    if not isinstance(raw, dict) or not {"id", "label"} <= set(raw) or set(raw) - _OPTION_KEYS:
        raise model.PlanningError(
            "each option requires id and label and may add description and recommended"
        )
    option: dict = {
        "id": key(raw["id"]),
        "label": model.text_field(raw["label"], "option.label", limit=200),
    }
    if "description" in raw:
        description = model.multiline_field(
            raw["description"], "option.description", limit=MAX_OPTION_DESCRIPTION
        )
        if not description:
            raise model.PlanningError("option.description is required when it is given")
        option["description"] = description
    if "recommended" in raw:
        if not isinstance(raw["recommended"], bool):
            raise model.PlanningError("option.recommended must be boolean")
        option["recommended"] = raw["recommended"]
    return option


def per_field(value: object, descriptors: list[dict], name: str, *, limit: int) -> dict:
    """An own variant or a comment for each field that offers options, keyed by its id."""

    if value is None:
        return {}
    if not isinstance(value, dict):
        raise model.PlanningError(f"{name} must be an object keyed by field ids")
    kinds = {field["id"]: field["type"] for field in descriptors}
    result: dict = {}
    for identity, raw in value.items():
        if identity not in kinds:
            raise model.PlanningError(f"{name} must be keyed by known field ids")
        if kinds[identity] not in _PICKED:
            raise model.PlanningError(
                f"{name}: {identity} is a text field, and its answer is already its own words"
            )
        said = model.multiline_field(raw, f"{name}.{identity}", limit=limit)
        if not said:
            raise model.PlanningError(f"{name}.{identity} is required when it is given")
        result[identity] = said
    return result


def _required(field: dict) -> str:
    if field["type"] in _PICKED:
        return (
            f"answer {field['id']} is required; give an option or your own variant in own;"
            " a note no longer stands in for a field"
        )
    return (
        f"answer {field['id']} is required; write it in answers;"
        " a note no longer stands in for a field"
    )


def answers(value: object, descriptors: list[dict], *, own: dict | None = None) -> dict:
    """The answers as given, each checked against its field.

    A required field is answered by a value or by its own variant in `own`, which
    `per_field` has already checked. A comment, on a field or on the whole
    question, answers nothing.
    """

    own = own or {}
    if not isinstance(value, dict) or set(value) - {field["id"] for field in descriptors}:
        raise model.PlanningError("answers must be an object keyed by known field ids")
    result: dict = {}
    for field in descriptors:
        identity = field["id"]
        if identity not in value:
            if field["required"] and identity not in own:
                raise model.PlanningError(_required(field))
            continue
        answer = value[identity]
        kind = field["type"]
        if kind in _SINGLE and identity in own:
            raise model.PlanningError(f"answer {identity}: an option or your own variant, not both")
        options = {option["id"] for option in field["options"]}
        if kind == "boolean":
            valid = isinstance(answer, bool)
        elif kind == "multi_choice":
            valid = (
                isinstance(answer, list)
                and all(isinstance(entry, str) and entry in options for entry in answer)
                and len(answer) == len(set(answer))
            )
            if valid and field["required"] and not answer and identity not in own:
                valid = False
        else:
            valid = isinstance(answer, str) and len(answer) <= 8000 and "\x00" not in answer
            if valid and field["required"] and not answer.strip():
                valid = False
            if valid and kind == "choice" and answer not in options:
                valid = False
        if not valid:
            raise model.PlanningError(f"answer {identity} does not match its field")
        result[identity] = answer
    return result


def stored_answers(
    given: dict, note: str, *, own: dict | None = None, field_notes: dict | None = None
) -> dict:
    """What `answers_json` holds: the answers, and each part beside them that was given."""

    stored = dict(given)
    if own:
        stored[OWN_KEY] = own
    if field_notes:
        stored[NOTES_KEY] = field_notes
    if note:
        stored[NOTE_KEY] = note
    return stored


def split_answers(stored: dict | None) -> dict:
    """A read's `answers`, `own`, `field_notes` and `note`, apart again.

    A question with no answer yet has none of them. An answer has the three
    objects, empty when nothing was given, and its note or null. One given while
    a note still stood in for a field reads as it was stored: the field without
    an answer and the note a comment on the question.
    """

    if stored is None:
        return {"answers": None, "own": None, "field_notes": None, "note": None}
    given = dict(stored)
    return {
        "own": given.pop(OWN_KEY, {}),
        "field_notes": given.pop(NOTES_KEY, {}),
        "note": given.pop(NOTE_KEY, None),
        "answers": given,
    }


def _answer_label(field: dict, answer: object) -> str | None:
    """What a chosen answer reads as; a boolean or a text already reads as itself."""

    labels = {option["id"]: option["label"] for option in field["options"]}
    if field["type"] == "multi_choice" and isinstance(answer, list):
        return ", ".join(str(labels.get(entry, entry)) for entry in answer)
    if field["type"] == "choice":
        return str(labels.get(answer, answer))
    return None


def _clip(text: str) -> str:
    return text if len(text) <= MAX_COMPACT_TEXT else text[:MAX_COMPACT_TEXT] + "…"


def _answer_rows(descriptors: list[dict], parts: dict) -> tuple[list[dict], bool]:
    """Each field that came back with something, in the question's order, and whether one was cut.

    A field says something when it has a value, an own variant or a comment, and
    its row names the last two only when it has them. An empty answer is no
    value. A list of chosen ids has no length worth cutting; its labels do.
    """

    given = parts["answers"] or {}
    owns = parts["own"] or {}
    notes = parts["field_notes"] or {}
    rows = []
    clipped = False
    for field in descriptors:
        identity = field["id"]
        answer = given.get(identity)
        if answer == [] or (isinstance(answer, str) and not answer.strip()):
            answer = None
        if answer is None and identity not in owns and identity not in notes:
            continue
        label = _answer_label(field, answer) if answer is not None else None
        row: dict = {
            "field": identity,
            "value": _clip(answer) if isinstance(answer, str) else answer,
            "label": _clip(label) if label is not None else None,
        }
        clipped = clipped or row["value"] != answer or row["label"] != label
        for name, said in (("own", owns.get(identity)), ("note", notes.get(identity))):
            if said is not None:
                row[name] = _clip(said)
                clipped = clipped or row[name] != said
        rows.append(row)
    return rows, clipped


def answer_text(descriptors: list[dict], stored: dict) -> str:
    """What came back as one line: each field by its label, then the note on the question."""

    parts = split_answers(stored)
    labels = {field["id"]: field["label"] for field in descriptors}
    rows, _clipped = _answer_rows(descriptors, parts)
    lines = []
    for row in rows:
        said = []
        if row["value"] is not None:
            said.append(str(row["label"] if row["label"] is not None else row["value"]))
        if "own" in row:
            said.append(f"own variant: {row['own']}")
        head = ", ".join(said)
        if "note" in row:
            head = f"{head} (comment: {row['note']})" if head else f"(comment: {row['note']})"
        lines.append(f"{labels[row['field']]}: {head}")
    note = parts["note"]
    return "; ".join([*lines, note] if note else lines)


def _fits(item: dict) -> bool:
    """Whether a compact question is within its size, its `clipped` key counted.

    Measured with `json.dumps`'s roomier default separators, so no way of writing
    it without escaping text that is not ASCII comes out larger.
    """

    return len(json.dumps({**item, "clipped": True}, ensure_ascii=False)) <= MAX_COMPACT_JSON


def compact(record: dict, *, replies: int, last_reply: dict | None) -> dict:
    """A question for an agent that scans: what was asked and what came back, no options.

    `answered_by` and `answered_at` belong to an answer only, though the row also
    records who declined or withdrew a question and when. A changed answer shows
    the one it replaced as `previous`. `replies` counts the question's thread and
    `last_reply` quotes its latest reply as a thread's root carries it.
    `clipped` appears when anything was left out or cut: past `MAX_COMPACT_TEXT`
    in a text, or past `MAX_COMPACT_JSON` the replaced answer first and then the
    later fields of the current one.
    """

    prompt = record["prompt"]
    answered = record["status"] == "answered"
    note = record["note"]
    rows, clipped = _answer_rows(record["fields"], record)
    item = {
        "id": record["request_id"],
        "status": record["status"],
        "question": prompt[:QUESTION_PREVIEW] + ("…" if len(prompt) > QUESTION_PREVIEW else ""),
        "answer": [],
        "note": _clip(note) if note is not None else None,
        "answered_by": record["answered_by"] if answered else None,
        "by_person": record["by_person"],
        "answered_at": record["resolved_at"] if answered else None,
        "answer_version": record["answer_version"],
        "replies": replies,
        "last_reply": last_reply,
    }
    clipped = clipped or item["note"] != note
    for row in rows:
        if not _fits({**item, "answer": [*item["answer"], row]}):
            clipped = True
            break
        item["answer"].append(row)
    # Only text that nearly all escapes in JSON can leave this still too large.
    for name in ("note", "question"):
        while not _fits(item) and item[name] is not None and len(item[name]) > 2:
            item[name] = item[name][: len(item[name]) // 2] + "…"
            clipped = True
    while not _fits(item) and item["last_reply"] and len(item["last_reply"]["body"]) > 2:
        body = item["last_reply"]["body"]
        item["last_reply"] = {**item["last_reply"], "body": body[: len(body) // 2], "clipped": True}
        clipped = True
    if answered and record["answer_version"] >= 2 and record["history"]:
        # Nothing of the replaced answer while the current one lost a field.
        if len(item["answer"]) < len(rows):
            clipped = True
        else:
            item, cut = _with_previous(item, record["fields"], record["history"][-1])
            clipped = clipped or cut
    return {**item, "clipped": True} if clipped else item


def _with_previous(item: dict, descriptors: list[dict], version: dict) -> tuple[dict, bool]:
    """The compact question with the answer its current one replaced, in the room left.

    The current answer is placed first, so this is what a large question loses
    first: the later fields of the replaced answer, then its note, then all of it.
    """

    rows, clipped = _answer_rows(descriptors, version)
    previous: dict = {"answer": [], "note": None, "answered_at": version["answered_at"]}
    if not _fits({**item, "previous": previous}):
        return item, True
    for row in rows:
        if not _fits({**item, "previous": {**previous, "answer": [*previous["answer"], row]}}):
            clipped = True
            break
        previous["answer"].append(row)
    note = version["note"]
    if note is not None:
        shown: str | None = _clip(note)
        clipped = clipped or shown != note
        while shown is not None and not _fits({**item, "previous": {**previous, "note": shown}}):
            clipped = True
            shown = shown[: len(shown) // 2] + "…" if len(shown) > 2 else None
        previous["note"] = shown
    return {**item, "previous": previous}, clipped


def timestamp(value: object, field: str = "expires_at") -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise model.PlanningError(f"{field} must be an ISO timestamp or null")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise model.PlanningError(f"{field} must be an ISO timestamp") from error
    if parsed.tzinfo is None:
        raise model.PlanningError(f"{field} must include a timezone")
    return parsed.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")
