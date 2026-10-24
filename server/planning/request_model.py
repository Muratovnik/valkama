"""Strict typed question fields and answers, independent of storage."""

from __future__ import annotations

import re
from datetime import UTC, datetime

from . import model

STATUSES = frozenset({"pending", "answered", "declined", "expired"})
_KEY = re.compile(r"[a-z][a-z0-9_-]{0,63}\Z")


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
            if not isinstance(option, dict) or set(option) != {"id", "label"}:
                raise model.PlanningError("each option requires id and label")
            option_id = key(option["id"])
            if option_id in option_ids:
                raise model.PlanningError("option ids must be unique")
            option_ids.add(option_id)
            parsed.append(
                {
                    "id": option_id,
                    "label": model.text_field(option["label"], "option.label", limit=200),
                }
            )
        result.append(
            {
                "id": identity,
                "label": model.text_field(raw["label"], "field.label", limit=200),
                "type": kind,
                "required": raw["required"],
                "options": parsed,
            }
        )
    return result


def answers(value: object, descriptors: list[dict]) -> dict:
    if not isinstance(value, dict) or set(value) - {field["id"] for field in descriptors}:
        raise model.PlanningError("answers must be an object keyed by known field ids")
    result: dict = {}
    for field in descriptors:
        identity = field["id"]
        if identity not in value:
            if field["required"]:
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


def timestamp(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise model.PlanningError("expires_at must be an ISO timestamp or null")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise model.PlanningError("expires_at must be an ISO timestamp") from error
    if parsed.tzinfo is None:
        raise model.PlanningError("expires_at must include a timezone")
    return parsed.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")
