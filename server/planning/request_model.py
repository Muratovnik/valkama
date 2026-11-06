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
#: How many fields one question holds: a review of a few dozen points, each a row
#: with its steps under it, and the 64 KiB above stop long descriptions first.
MAX_FIELDS = 40
#: The three answers of a `verdict` field, in the order every read names them.
VERDICTS = ("accept", "later", "reject")
#: The fields a person picks from. Only these take an own variant or a comment:
#: a text field is already the person's own words.
_PICKED = frozenset({"choice", "multi_choice", "boolean", "verdict"})
#: The fields with one answer, which an own variant takes the place of; a
#: multi_choice field takes it beside the options chosen.
_SINGLE = frozenset({"choice", "boolean", "verdict"})
#: What a field under another may stand under: one whose answer names an option.
_PARENTS = frozenset({"verdict", "choice", "multi_choice"})
_FIELD_KEYS = frozenset({"id", "label", "type", "required", "options"})
_FIELD_EXTRAS = frozenset({"description", "group", "under", "recommended"})
#: How much of the prompt the compact form of a question quotes.
QUESTION_PREVIEW = 160
#: How much of a note or a written answer the compact form quotes, and how large one
#: compact question may be as JSON. An agent pulls answers often, so what a person
#: wrote at length stays one `get_work_item_request` away.
MAX_COMPACT_TEXT = 500
MAX_COMPACT_JSON = 2000
#: How much of an own variant, a comment or a note the difference of a change quotes.
MAX_CHANGE_QUOTE = 60
#: What marks an option a change removed, as the contract writes it: U+2212, not a hyphen.
MINUS = "\u2212"
_KEY = re.compile(r"[a-z][a-z0-9_-]{0,63}\Z")
_OPTION_KEYS = frozenset({"id", "label", "description", "recommended"})


def key(value: object) -> str:
    if not isinstance(value, str) or not _KEY.fullmatch(value):
        raise model.PlanningError("field and option ids must be stable lowercase identifiers")
    return value


def fields(value: object) -> list[dict]:
    """A question's fields as stored, each refusal naming the field and how to put it right.

    A field under another stays one more entry of the flat list: the schema has no
    nesting to get wrong, and `under` names an earlier field and one of its answers.
    """

    if not isinstance(value, list) or not 1 <= len(value) <= MAX_FIELDS:
        raise model.PlanningError(f"fields must contain between 1 and {MAX_FIELDS} fields")
    result: list[dict] = []
    earlier: dict[str, dict] = {}
    for raw in value:
        if (
            not isinstance(raw, dict)
            or not _FIELD_KEYS.issubset(raw)
            or set(raw) - _FIELD_KEYS - _FIELD_EXTRAS
        ):
            raise model.PlanningError(
                "each field requires id, label, type, required and options"
                " and may add description, group, under and recommended"
            )
        identity = key(raw["id"])
        if identity in earlier:
            raise model.PlanningError("field ids must be unique")
        kind = model.enum_field(
            raw["type"],
            frozenset({"text", "choice", "multi_choice", "boolean", "verdict"}),
            "field.type",
        )
        if not isinstance(raw["required"], bool):
            raise model.PlanningError("field.required must be boolean")
        options = raw["options"]
        if not isinstance(options, list) or len(options) > 20:
            raise model.PlanningError("field.options must be an array of at most 20 options")
        if kind == "verdict" and options:
            raise model.PlanningError(
                f"field {identity}: a verdict takes no options; put steps or ways in a field"
                f" with under: {{field: {identity}, option: accept}}"
            )
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
        field = {
            "id": identity,
            "label": model.text_field(raw["label"], "field.label", limit=200),
            "type": kind,
            "required": raw["required"],
            "options": parsed,
            **_field_extras(raw, identity, kind, earlier),
        }
        result.append(field)
        earlier[identity] = field
    _groups_stand_together(result, earlier)
    if len(model.dumps(result).encode("utf-8")) > MAX_FIELDS_BYTES:
        raise model.PlanningError("the fields of one question must fit in 64 KiB as stored")
    return result


def _field_extras(raw: dict, identity: str, kind: str, earlier: dict[str, dict]) -> dict:
    """The four keys a field may add, each only when it was given."""

    extras: dict = {}
    if "description" in raw:
        description = model.multiline_field(
            raw["description"], "field.description", limit=MAX_OPTION_DESCRIPTION
        )
        if not description:
            raise model.PlanningError("field.description is required when it is given")
        extras["description"] = description
    if "group" in raw:
        extras["group"] = model.text_field(raw["group"], "field.group", limit=200)
    if "recommended" in raw:
        if kind != "verdict":
            raise model.PlanningError(
                f"field {identity}: recommended on a field is for a verdict;"
                " in a choice put it on the option"
            )
        if raw["recommended"] not in VERDICTS:
            raise model.PlanningError(f"field {identity}: recommended is accept, later or reject")
        extras["recommended"] = raw["recommended"]
    if "under" in raw:
        extras["under"] = _under(raw["under"], identity, earlier)
        parent = earlier[extras["under"]["field"]]
        if "group" in extras and extras["group"] != parent.get("group"):
            raise model.PlanningError(
                f"field {identity}: a field under {parent['id']} stands in {parent['id']}'s"
                " group; leave group out"
            )
    return extras


def _under(raw: object, identity: str, earlier: dict[str, dict]) -> dict:
    """The parent a field stands under: an earlier field of one level, and one of its answers."""

    if (
        not isinstance(raw, dict)
        or set(raw) != {"field", "option"}
        or not all(isinstance(value, str) for value in raw.values())
    ):
        raise model.PlanningError(
            f"field {identity}: under is {{field, option}}, an earlier field's id and one of"
            " its answers"
        )
    name, option = raw["field"], raw["option"]
    parent = earlier.get(name)
    if parent is None:
        raise model.PlanningError(
            f"field {identity}: under names {name}, which no earlier field has;"
            " a parent stands before its children"
        )
    if parent["type"] not in _PARENTS:
        raise model.PlanningError(
            f"field {identity}: under names {name}, a {parent['type']} field;"
            " a parent is a verdict, choice or multi_choice field"
        )
    if "under" in parent:
        above = parent["under"]["field"]
        raise model.PlanningError(
            f"field {identity}: under names {name}, which stands under {above};"
            f" one level: put it under {above}"
        )
    if parent["type"] == "verdict":
        if option not in VERDICTS:
            raise model.PlanningError(
                f"field {identity}: {name} is a verdict, so under.option is accept, later or reject"
            )
    elif option not in {entry["id"] for entry in parent["options"]}:
        raise model.PlanningError(f"field {identity}: option {option} is not an option of {name}")
    return {"field": name, "option": option}


def group_of(field: dict, by_id: dict[str, dict]) -> str | None:
    """The group a field stands in: its own, or its parent's when it names none."""

    if "group" in field:
        return str(field["group"])
    if "under" in field:
        parent = by_id.get(field["under"]["field"])
        return None if parent is None else parent.get("group")
    return None


def _groups_stand_together(result: list[dict], by_id: dict[str, dict]) -> None:
    """Refuse a group that another group, or a field with none, stands in the middle of."""

    split_by: dict[str, str] = {}
    current: str | None = None
    for field in result:
        group = group_of(field, by_id)
        if group == current:
            continue
        if current is not None:
            split_by[current] = group if group is not None else f"{field['id']}, which has no group"
        if group is not None and group in split_by:
            raise model.PlanningError(
                f"group {group} is split by {split_by[group]}: fields of one group stand together"
            )
        current = group


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


def holds(answers: dict, under: dict) -> bool:
    """Whether a parent's answer holds the option a field stands under.

    Its verdict, its chosen option or one of its chosen options does; an own
    variant holds none, and nothing is worked out from what is chosen under it.
    """

    value = answers.get(under["field"])
    return under["option"] in value if isinstance(value, list) else value == under["option"]


def shown(field: dict, answers: dict) -> bool:
    """Whether a field is shown and answered: always, or while its parent holds its option."""

    return "under" not in field or holds(answers, field["under"])


def _reads_as(identity: str, answers: dict, own: dict) -> str:
    """A parent's answer as a refusal names it."""

    value = answers.get(identity)
    if isinstance(value, list) and value:
        return ", ".join(str(entry) for entry in value)
    if isinstance(value, str) and value:
        return value
    return "own variant" if identity in own else "unanswered"


def _hidden(field: dict, answers: dict, own: dict) -> str:
    parent, option = field["under"]["field"], field["under"]["option"]
    return (
        f"answer {field['id']} stands under {parent}={option}, and {parent} is"
        f" {_reads_as(parent, answers, own)}; leave it out"
    )


def _required_under(field: dict) -> str:
    parent, option = field["under"]["field"], field["under"]["option"]
    give = (
        "give an option or your own variant in own"
        if field["type"] in _PICKED
        else "write it in answers"
    )
    return f"answer {field['id']} is required because {parent} is {option}; {give}"


def answers(
    value: object,
    descriptors: list[dict],
    *,
    own: dict | None = None,
    field_notes: dict | None = None,
) -> dict:
    """The answers as given, each checked against its field.

    A required field is answered by a value or by its own variant in `own`, which
    `per_field` has already checked. A comment, on a field or on the whole
    question, answers nothing. A field under another is answered only while its
    parent, which stands earlier and so is checked first, holds its option: a
    hidden one takes no value, own variant or comment, and is required only when
    shown.
    """

    own = own or {}
    notes = field_notes or {}
    if not isinstance(value, dict) or set(value) - {field["id"] for field in descriptors}:
        raise model.PlanningError("answers must be an object keyed by known field ids")
    result: dict = {}
    for field in descriptors:
        identity = field["id"]
        if not shown(field, result):
            if identity in value or identity in own or identity in notes:
                raise model.PlanningError(_hidden(field, result, own))
            continue
        if identity not in value:
            if field["required"] and identity not in own:
                raise model.PlanningError(
                    _required_under(field) if "under" in field else _required(field)
                )
            continue
        answer = value[identity]
        kind = field["type"]
        if kind in _SINGLE and identity in own:
            raise model.PlanningError(f"answer {identity}: an option or your own variant, not both")
        options = {option["id"] for option in field["options"]}
        if kind == "verdict":
            if answer not in VERDICTS:
                raise model.PlanningError(f"answer {identity} is accept, later or reject")
            result[identity] = answer
            continue
        if kind == "boolean":
            valid = isinstance(answer, bool)
            empty = False
        elif kind == "multi_choice":
            valid = (
                isinstance(answer, list)
                and all(isinstance(entry, str) and entry in options for entry in answer)
                and len(answer) == len(set(answer))
            )
            empty = valid and not answer and identity not in own
        else:
            valid = isinstance(answer, str) and len(answer) <= 8000 and "\x00" not in answer
            empty = valid and not answer.strip()
            if valid and kind == "choice" and answer not in options:
                valid = False
        if empty and field["required"]:
            if "under" in field:
                raise model.PlanningError(_required_under(field))
            valid = False
        if not valid:
            raise model.PlanningError(f"answer {identity} does not match its field")
        result[identity] = answer
    return result


def same_answer(descriptors: list[dict], given: dict, stored: dict) -> bool:
    """Whether two answers as `answers_json` holds them say the same.

    A `multi_choice` answer is the set of options chosen, so the order they were
    sent in does not make it another answer.
    """

    sets = {field["id"] for field in descriptors if field["type"] == "multi_choice"}

    def chosen(answer: dict) -> dict:
        return {
            name: sorted(value) if name in sets and isinstance(value, list) else value
            for name, value in answer.items()
        }

    return chosen(given) == chosen(stored)


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


def is_review(descriptors: list[dict]) -> bool:
    """Whether a question is a review: one with a `verdict` field, read with two more keys."""

    return any(field["type"] == "verdict" for field in descriptors)


def _answer_rows(
    descriptors: list[dict], parts: dict, *, review: bool = False
) -> tuple[list[dict], bool]:
    """Each field that came back with something, in the question's order, and whether one was cut.

    A field says something when it has a value, an own variant or a comment, and
    its row names the last two only when it has them. An empty answer is no
    value. A list of chosen ids has no length worth cutting; its labels do.

    In a review a verdict has a row only for its comment or own variant, since
    `verdicts` already says the rest; a field under another names its parent in
    `under`, and a `multi_choice` there says how many options it offers in `of`
    and never carries a label, so its steps read as a count.
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
        said = identity in owns or identity in notes
        if (answer is None and not said) or (review and field["type"] == "verdict" and not said):
            continue
        counted = review and "under" in field and field["type"] == "multi_choice"
        label = _answer_label(field, answer) if answer is not None and not counted else None
        row: dict = {"field": identity}
        if review and "under" in field:
            row["under"] = field["under"]["field"]
            if counted:
                row["of"] = len(field["options"])
        row["value"] = _clip(answer) if isinstance(answer, str) else answer
        row["label"] = _clip(label) if label is not None else None
        clipped = clipped or row["value"] != answer or row["label"] != label
        for name, text in (("own", owns.get(identity)), ("note", notes.get(identity))):
            if text is not None:
                row[name] = _clip(text)
                clipped = clipped or row[name] != text
        rows.append(row)
    return rows, clipped


def _verdicts(descriptors: list[dict], parts: dict) -> dict:
    """A review's `verdicts` and `undecided`: every shown verdict field in one of them or decided otherwise.

    A verdict field given an own variant is decided and in neither; a hidden one
    is in neither too.
    """

    given = parts["answers"] or {}
    owns = parts["own"] or {}
    verdicts: dict[str, list[str]] = {word: [] for word in VERDICTS}
    undecided: list[str] = []
    for field in descriptors:
        if field["type"] != "verdict" or not shown(field, given):
            continue
        value = given.get(field["id"])
        if value in VERDICTS:
            verdicts[str(value)].append(field["id"])
        elif field["id"] not in owns:
            undecided.append(field["id"])
    return {"verdicts": verdicts, "undecided": undecided}


def _list_undecided(descriptors: list[dict], parts: dict) -> dict:
    """A list's `undecided`: its field while nothing on it is ticked, and nothing otherwise.

    The person may send a list with nothing ticked, and that says the list is not
    decided yet, which an answer with no row would leave an agent to guess.
    """

    given = parts["answers"] or {}
    owns = parts["own"] or {}
    return {
        "undecided": [
            field["id"]
            for field in descriptors
            if not given.get(field["id"]) and field["id"] not in owns
        ]
    }


def _row_line(row: dict, name: str) -> str:
    """One field of an answer as a notice quotes it: `name: choice`, with what it adds."""

    said = []
    if row["value"] is not None:
        said.append(str(row["label"] if row["label"] is not None else row["value"]))
    if "own" in row:
        said.append(f"own variant: {row['own']}")
    head = ", ".join(said)
    if "note" in row:
        head = f"{head} (comment: {row['note']})" if head else f"(comment: {row['note']})"
    return f"{name}: {head}"


def answer_text(descriptors: list[dict], stored: dict, *, listed: bool = False) -> str:
    """What came back as one line: each field by its label, then the note on the question.

    A review reads as a summary instead, since a row per point does not fit a notice. A
    list (`listed`) sent with nothing ticked says so, `label: not decided`, where a
    question's empty field says nothing.
    """

    parts = split_answers(stored)
    if is_review(descriptors):
        return _review_text(descriptors, parts)
    labels = {field["id"]: field["label"] for field in descriptors}
    rows, _clipped = _answer_rows(descriptors, parts)
    undecided = _list_undecided(descriptors, parts)["undecided"] if listed else []
    lines = [
        *(f"{labels[identity]}: not decided" for identity in undecided),
        *(_row_line(row, labels[row["field"]]) for row in rows),
    ]
    note = parts["note"]
    return "; ".join([*lines, note] if note else lines)


def _review_text(descriptors: list[dict], parts: dict) -> str:
    """A review as a notice quotes it.

    The verdict most fields have as a count, the earlier word on a tie, then the
    other two by their fields; then the own variants, the fields under another,
    any other field, the undecided fields and the note. A comment follows its
    field, and a commented field of the counted verdict is named after the count.
    """

    given = parts["answers"] or {}
    owns = parts["own"] or {}
    notes = parts["field_notes"] or {}

    def commented(identity: str, text: str | None = None) -> str:
        head = identity if text is None else text
        return f"{head} (comment: {_clip(notes[identity])})" if identity in notes else head

    lists = _verdicts(descriptors, parts)
    verdicts = lists["verdicts"]
    counted = max(VERDICTS, key=lambda word: len(verdicts[word]))
    segments = []
    if verdicts[counted]:
        named = [commented(identity) for identity in verdicts[counted] if identity in notes]
        segments.append(", ".join([f"{counted} {len(verdicts[counted])}", *named]))
    segments.extend(
        f"{word}: " + ", ".join(commented(identity) for identity in verdicts[word])
        for word in VERDICTS
        if word != counted and verdicts[word]
    )
    owned: list[str] = []
    under: list[str] = []
    other: list[str] = []
    for field in descriptors:
        identity = field["id"]
        if not shown(field, given):
            continue
        value, own = given.get(identity), owns.get(identity)
        if field["type"] == "verdict":
            if own is not None:
                owned.append(commented(identity, f"{identity} own variant: {_clip(own)}"))
        elif "under" in field:
            line = _under_line(field, value, own)
            if line is not None or identity in notes:
                under.append(commented(identity, line))
        else:
            rows, _clipped = _answer_rows([field], parts)
            other.extend(_row_line(row, field["label"]) for row in rows)
    segments.extend([*owned, *under, *other])
    if lists["undecided"]:
        segments.append("undecided: " + ", ".join(map(commented, lists["undecided"])))
    if parts["note"]:
        segments.append(_clip(parts["note"]))
    return "; ".join(segments)


def _under_line(field: dict, value: object, own: str | None) -> str | None:
    """A field under another in a review's summary: steps as chosen/offered, a way by its id."""

    identity = field["id"]
    if field["type"] == "multi_choice":
        chosen = len(value) if isinstance(value, list) else 0
        if not chosen and own is None:
            return None
        line = f"{identity} {chosen}/{len(field['options'])}"
        return f"{line}, own variant: {_clip(own)}" if own is not None else line
    if value is not None and value != "":
        return f"{identity}: {_clip(str(value))}"
    return f"{identity} own variant: {_clip(own)}" if own is not None else None


def difference(descriptors: list[dict], old: dict, new: dict) -> list[str]:
    """What a change changed, a row for each part of a field that differs, then the note.

    Field by field in the question's order, each its value, then its own variant,
    then its comment. Ids and words read as stored; no value on one side is `—`.
    """

    before, after = split_answers(old), split_answers(new)
    rows: list[str] = []
    for field in descriptors:
        identity = field["id"]
        was, now = before["answers"].get(identity), after["answers"].get(identity)
        if field["type"] == "multi_choice":
            rows.extend(_options_changed(field, was, now))
        elif field["type"] == "text":
            if (was or "") != (now or ""):
                rows.append(f"{identity} rewritten")
        elif was != now:
            rows.append(f"{identity} {_word(was)}→{_word(now)}")
        rows.extend(
            _said_changed(
                f"{identity} own variant", before["own"].get(identity), after["own"].get(identity)
            )
        )
        rows.extend(
            _said_changed(
                f"{identity} comment",
                before["field_notes"].get(identity),
                after["field_notes"].get(identity),
            )
        )
    rows.extend(_said_changed("note", before["note"], after["note"]))
    return rows


def change_text(descriptors: list[dict], old: dict, new: dict, *, limit: int) -> str:
    """`changed: ` and the rows of `difference`, within `limit`: what does not fit is counted."""

    rows = difference(descriptors, old, new)
    head = "changed: "
    for count in range(len(rows), 0, -1):
        left = len(rows) - count
        text = head + "; ".join(rows[:count]) + (f"; and {left} more" if left else "")
        if len(text) <= limit:
            return text
    if not rows:
        return "changed"
    # One row longer than the room alone: a multi_choice that swapped many long ids.
    tail = f"; and {len(rows) - 1} more" if len(rows) > 1 else ""
    return head + rows[0][: limit - len(head) - len(tail) - 1] + "…" + tail


def _options_changed(field: dict, was: object, now: object) -> list[str]:
    """`id +added`, then each removed one after a minus sign, in the order the field offers
    its options."""

    before = set(was) if isinstance(was, list) else set()
    after = set(now) if isinstance(now, list) else set()
    rank = {option["id"]: place for place, option in enumerate(field["options"])}

    def ordered(found: set) -> list[str]:
        return sorted(
            (str(entry) for entry in found), key=lambda entry: (rank.get(entry, len(rank)), entry)
        )

    added, removed = ordered(after - before), ordered(before - after)
    if not added and not removed:
        return []
    return [
        f"{field['id']} "
        + " ".join([*(f"+{entry}" for entry in added), *(f"{MINUS}{entry}" for entry in removed)])
    ]


def _said_changed(name: str, was: str | None, now: str | None) -> list[str]:
    if now and now != was:
        return [f"{name}: {_quote(now)}"]
    if was and not now:
        return [f"{name} removed"]
    return []


def _word(value: object) -> str:
    if value is None:
        return "—"
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _quote(text: str) -> str:
    return text if len(text) <= MAX_CHANGE_QUOTE else text[: MAX_CHANGE_QUOTE - 1] + "…"


def _fits(item: dict) -> bool:
    """Whether a compact question is within its size, its `clipped` key counted.

    Measured with `json.dumps`'s roomier default separators, so no way of writing
    it without escaping text that is not ASCII comes out larger.
    """

    return len(json.dumps({**item, "clipped": True}, ensure_ascii=False)) <= MAX_COMPACT_JSON


def _with_rows(item: dict, rows: list[dict]) -> tuple[dict, bool]:
    """The compact question with its rows, and whether any of them lost something.

    Past the size it leaves out every label at once, and only then the later
    fields, so a reader learns each field that was answered before it loses one.
    """

    whole = {**item, "answer": rows}
    if _fits(whole):
        return whole, False
    placed: list[dict] = []
    for row in rows:
        bare = {**row, "label": None}
        if not _fits({**item, "answer": [*placed, bare]}):
            break
        placed.append(bare)
    return {**item, "answer": placed}, True


def compact(record: dict, *, replies: int, last_reply: dict | None) -> dict:
    """A question for an agent that scans: what was asked and what came back, no options.

    `answered_by` and `answered_at` belong to an answer only, though the row also
    records who declined or withdrew a question and when. A changed answer shows
    the one it replaced as `previous`. `replies` counts the question's thread and
    `last_reply` quotes its latest reply as a thread's root carries it. A review
    adds `verdicts` and `undecided`, which stand whole before any row, and a list
    on a comment `comment_id`, the comment it stands under, and `undecided`, its
    field while nothing on it is ticked.
    `clipped` appears when anything was left out or cut: past `MAX_COMPACT_TEXT`
    in a text, or past `MAX_COMPACT_JSON` the replaced answer first, then every
    label, then the later fields of the current one.
    """

    prompt = record["prompt"]
    answered = record["status"] == "answered"
    note = record["note"]
    descriptors = record["fields"]
    review = is_review(descriptors)
    listed = record.get("comment_id") is not None
    rows, clipped = _answer_rows(descriptors, record, review=review)
    item = {
        "id": record["request_id"],
        "status": record["status"],
        "question": prompt[:QUESTION_PREVIEW] + ("…" if len(prompt) > QUESTION_PREVIEW else ""),
        # Only a list stands under a comment, and only a list says which.
        **({"comment_id": record["comment_id"]} if listed else {}),
        **(_verdicts(descriptors, record) if review else {}),
        **(_list_undecided(descriptors, record) if listed else {}),
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
    item, lost = _with_rows(item, rows)
    clipped = clipped or lost
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
        # Nothing of the replaced answer while the current one lost a label or a field.
        if lost:
            clipped = True
        else:
            item, cut = _with_previous(
                item, descriptors, record["history"][-1], review=review, listed=listed
            )
            clipped = clipped or cut
    return {**item, "clipped": True} if clipped else item


def _with_previous(
    item: dict, descriptors: list[dict], version: dict, *, review: bool, listed: bool
) -> tuple[dict, bool]:
    """The compact question with the answer its current one replaced, in the room left.

    The current answer is placed first, so this is what a large question loses
    first: the later fields of the replaced answer, then its note, then all of it.
    """

    rows, clipped = _answer_rows(descriptors, version, review=review)
    previous: dict = {
        **(_verdicts(descriptors, version) if review else {}),
        **(_list_undecided(descriptors, version) if listed else {}),
        "answer": [],
        "note": None,
        "answered_at": version["answered_at"],
    }
    if not _fits({**item, "previous": previous}):
        return item, True
    for row in rows:
        if not _fits({**item, "previous": {**previous, "answer": [*previous["answer"], row]}}):
            clipped = True
            break
        previous["answer"].append(row)
    note = version["note"]
    if note is not None:
        shown_note: str | None = _clip(note)
        clipped = clipped or shown_note != note
        while shown_note is not None and not _fits(
            {**item, "previous": {**previous, "note": shown_note}}
        ):
            clipped = True
            shown_note = shown_note[: len(shown_note) // 2] + "…" if len(shown_note) > 2 else None
        previous["note"] = shown_note
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
