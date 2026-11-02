"""Strict typed question fields and answers, independent of storage."""

from __future__ import annotations

import re
from datetime import UTC, datetime

from . import model

STATUSES = frozenset({"pending", "answered", "declined", "expired"})
MAX_NOTE = 8000
MAX_OPTION_DESCRIPTION = 8000
#: A question's fields as stored. A description may run to 8000 characters on each
#: of 20 options of 12 fields, and that is not a question anyone can read.
MAX_FIELDS_BYTES = 64 * 1024
#: Where a note sits in `answers_json`. A field id starts with a letter, so no
#: field can be called this and an answer cannot be mistaken for a note.
NOTE_KEY = "_note"
#: How much of the prompt the compact form of a question quotes.
QUESTION_PREVIEW = 160
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


def answers(value: object, descriptors: list[dict], *, note: str = "") -> dict:
    """The answers as given, each checked against its field.

    A note stands in for a required field left out, so a person can answer in
    their own words. It does not excuse an answer that was given and is wrong.
    """

    if not isinstance(value, dict) or set(value) - {field["id"] for field in descriptors}:
        raise model.PlanningError("answers must be an object keyed by known field ids")
    result: dict = {}
    for field in descriptors:
        identity = field["id"]
        if identity not in value:
            if field["required"] and not note:
                raise model.PlanningError(f"answer {identity} is required")
            continue
        answer = value[identity]
        kind = field["type"]
        options = {option["id"] for option in field["options"]}
        if kind == "boolean":
            valid = isinstance(answer, bool)
        elif kind == "multi_choice":
            valid = (
                isinstance(answer, list)
                and all(isinstance(entry, str) and entry in options for entry in answer)
                and len(answer) == len(set(answer))
            )
            if valid and field["required"] and not answer:
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


def stored_answers(given: dict, note: str) -> dict:
    """What `answers_json` holds: the answers, and the note beside them when there is one."""

    return {**given, NOTE_KEY: note} if note else given


def split_answers(stored: dict | None) -> tuple[dict | None, str | None]:
    """A read's `answers` and `note`, apart again. A question with no answer yet has neither."""

    if stored is None:
        return None, None
    given = dict(stored)
    return given, given.pop(NOTE_KEY, None)


def _answer_label(field: dict, answer: object) -> str | None:
    """What a chosen answer reads as; a boolean or a text already reads as itself."""

    labels = {option["id"]: option["label"] for option in field["options"]}
    if field["type"] == "multi_choice" and isinstance(answer, list):
        return ", ".join(str(labels.get(entry, entry)) for entry in answer)
    if field["type"] == "choice":
        return str(labels.get(answer, answer))
    return None


def _answer_rows(descriptors: list[dict], given: dict | None) -> list[dict]:
    """Each answered field, in the question's order. An empty answer names nothing."""

    rows = []
    for field in descriptors:
        answer = (given or {}).get(field["id"])
        if answer is None or answer == [] or (isinstance(answer, str) and not answer.strip()):
            continue
        rows.append({"field": field["id"], "value": answer, "label": _answer_label(field, answer)})
    return rows


def compact(record: dict) -> dict:
    """A question for an agent that scans: what was asked and what came back, no options.

    `answered_by` and `answered_at` belong to an answer only, though the row also
    records who declined or withdrew a question and when.
    """

    prompt = record["prompt"]
    answered = record["status"] == "answered"
    return {
        "id": record["request_id"],
        "status": record["status"],
        "question": prompt[:QUESTION_PREVIEW] + ("…" if len(prompt) > QUESTION_PREVIEW else ""),
        "answer": _answer_rows(record["fields"], record["answers"]),
        "note": record["note"],
        "answered_by": record["answered_by"] if answered else None,
        "by_person": record["by_person"],
        "answered_at": record["resolved_at"] if answered else None,
    }


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
