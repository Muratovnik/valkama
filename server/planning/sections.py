"""The sections of a work item's description, and the keys an agent reads them by.

A card carries its description whole. An agent that wants to refresh one piece of
a long one reads that piece by its key instead of the whole text again.

A line that starts with one to six `#` and a space, outside a fenced code block,
opens a section, and the section lasts until the next heading of its level or a
higher one, so it holds its subsections. The text before the first heading is the
section `(start)`. A section's text is the span it covers, its heading line and the
blank lines after it included, so the sections no other holds, read in order, are the
description itself. A description without a heading is divided into paragraphs: the
text between blank lines outside a fenced block.

A heading's key is its text with the spaces run together; a paragraph's is `p` and
the first eight hex digits of the SHA-256 of its text with the spaces run together.
A key repeated in one description takes " (2)", " (3)" in order, and so does a
heading that reads `(start)`. Keys compare without case. Nothing is stored: each
read derives the keys from the text, so an edit to one section changes no other
key, and a key whose text is gone is refused rather than read as something else.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Sequence
from dataclasses import dataclass

from . import model

#: The key of the text before the first heading.
START = "(start)"
#: How long a description is before the card names its sections: a shorter one is
#: cheaper to read whole than to read about.
CARD_FROM = 2000
#: How many keys a refusal of an unknown key names before it counts the rest.
NAMED_KEYS = 20
#: How much of a paragraph its entry in the contents shows.
STARTS = 60

_HEADING = re.compile(r"(#{1,6}) (.*)")
#: A closing run of `#`, which belongs to the heading's mark and not to its text.
_CLOSING = re.compile(r"(?:^|\s)#+\s*$")
_FENCE = re.compile(r" {0,3}(`{3,}|~{3,})")


@dataclass(frozen=True)
class Section:
    """One section: its key, its heading's level (0 for the start, None for a
    paragraph) and its text."""

    key: str
    level: int | None
    text: str


def of(description: str) -> list[Section]:
    """The description's sections in the order of its text."""

    lines = _lines(description)
    headings = [(start, level, title) for start, level, title, _blank in lines if level]
    if headings:
        return _keyed(_by_heading(description, headings), reserved=(START,))
    return _keyed(_by_paragraph(description, lines), reserved=())


def contents(description: str) -> list[dict]:
    """The table of the sections: each key with its level or its start, and its size."""

    return [
        {"key": section.key, "level": section.level, "chars": len(section.text)}
        if section.level is not None
        else {
            "key": section.key,
            "chars": len(section.text),
            "starts": _spaced(section.text)[:STARTS],
        }
        for section in of(description)
    ]


def named(description: str, keys: Sequence[str]) -> list[dict]:
    """The sections the keys name, with their text, in the order of the description.

    A key no section has is refused with the keys there are, so an agent holding a
    key from before an edit learns that its text is gone.
    """

    found = of(description)
    have = {section.key.casefold() for section in found}
    for key in keys:
        if key.casefold() not in have:
            raise model.PlanningError(
                f"unknown section '{key}'; sections are {_listed([s.key for s in found])}"
            )
    asked = {key.casefold() for key in keys}
    return [
        {
            "key": section.key,
            **({} if section.level is None else {"level": section.level}),
            "chars": len(section.text),
            "text": section.text,
        }
        for section in found
        if section.key.casefold() in asked
    ]


def card_count(description: str) -> int:
    """How many sections the card names: none for a description of `CARD_FROM` or fewer."""

    return len(of(description)) if len(description) > CARD_FROM else 0


def _lines(description: str) -> list[tuple[int, int, str, bool]]:
    """Each line's offset, its heading's level and text (0 and "" when it is not a
    heading), and whether it is blank outside a fenced block."""

    found: list[tuple[int, int, str, bool]] = []
    fence = ""
    offset = 0
    for line in description.splitlines(keepends=True):
        content = line.rstrip("\r\n")
        level, title, blank = 0, "", False
        opening = _FENCE.match(content)
        if fence:
            # A fence closes on a line of its own mark alone, at least as long.
            run = opening.group(1) if opening else ""
            if run.startswith(fence) and content.strip() == run:
                fence = ""
        elif opening:
            fence = opening.group(1)
        else:
            heading = _HEADING.match(content)
            title = _spaced(_CLOSING.sub("", heading.group(2))) if heading else ""
            level = len(heading.group(1)) if heading and title else 0
            blank = not content.strip()
        found.append((offset, level, title, blank))
        offset += len(line)
    return found


def _by_heading(description: str, headings: list[tuple[int, int, str]]) -> list[Section]:
    first = headings[0][0]
    found = []
    if description[:first].strip():
        found.append(Section(START, 0, description[:first]))
    for index, (start, level, title) in enumerate(headings):
        end = next(
            (other for other, deeper, _ in headings[index + 1 :] if deeper <= level),
            len(description),
        )
        found.append(Section(title, level, description[start:end]))
    return found


def _by_paragraph(description: str, lines: list[tuple[int, int, str, bool]]) -> list[Section]:
    found = []
    start: int | None = None
    for offset, _level, _title, blank in [*lines, (len(description), 0, "", True)]:
        if blank and start is not None:
            # A paragraph is its lines, without the break before the blank line.
            text = description[start:offset].rstrip("\r\n")
            found.append(Section("p" + _digest(text), None, text))
            start = None
        elif not blank and start is None:
            start = offset
    return found


def _keyed(found: list[Section], *, reserved: tuple[str, ...]) -> list[Section]:
    """The sections with each repeated key numbered in order; a reserved key is taken
    by its own section, so a heading that repeats it is numbered too."""

    used = {key.casefold() for key in reserved}
    keyed = []
    for section in found:
        key = section.key
        if section.level == 0:
            keyed.append(section)
            continue
        number = 1
        while key.casefold() in used:
            number += 1
            key = f"{section.key} ({number})"
        used.add(key.casefold())
        keyed.append(Section(key, section.level, section.text))
    return keyed


def _listed(keys: list[str]) -> str:
    if not keys:
        return "none"
    shown = ", ".join(keys[:NAMED_KEYS])
    rest = len(keys) - NAMED_KEYS
    return f"{shown} and {rest} more" if rest > 0 else shown


def _spaced(text: str) -> str:
    return " ".join(text.split())


def _digest(text: str) -> str:
    return hashlib.sha256(_spaced(text).encode("utf-8")).hexdigest()[:8]
