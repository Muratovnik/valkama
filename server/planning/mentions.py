"""Finding the work item numbers in Markdown an agent wrote, and nothing else.

A number is a mention only where a reader sees it as prose. Fenced and indented
code, code spans, the text and target of a link, a reference definition, an
autolink, a raw HTML tag and a bare URL are left as they were, whatever they hold.
A shape is a candidate and nothing more: `UTF-8` and `SHA-256` have the shape of a
reference, and whoever holds the store decides which candidates are real.

The fences around a mention are the interface's (`web/src/shared/lib/textReferences.ts`):
a letter or digit of any script, `_` or `-` on either side, or a `.` followed by a
letter or digit, makes it the middle of something longer. So `XMAIN-12` is a mention
of a space called `XMAIN`, while `MAIN-12a`, `MAIN-12-3`, `MAIN-12.md` and a Cyrillic
word glued to the key are none, and a slash is no fence, so `MAIN-12/MAIN-13` is two.
Beyond the interface's, a backslash before a letter and an `@` fence too: here the text
is an agent's, and it writes Windows paths and addresses in prose.

Scanning is one pass over whole lines, with what must outlive a line in `ScanState`
so a message may arrive in parts. It holds counters and no text. It errs one way: a
construct it cannot be sure of keeps its text as written, so the worst outcome is a
plain number where a link could have been. Text in square brackets is never a mention
for that reason, because `[MAIN-12]` may be a reference link defined elsewhere, and
a stray backtick or bracket stays open until the paragraph ends.

This is written here rather than taken from a Markdown library because the server
imports only the standard library, and because what it needs is the opposite of a
parser's output: exact offsets into text that must otherwise come back unchanged.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import NamedTuple

from .model import HUMAN_ID_SHAPE

_BEFORE = r"(?<![\w\\@-])"
_AFTER = r"(?![\w@-]|[.\\][^\W_])"

#: Anything a blockquote or a list item puts before a block on its line.
_CONTAINER = r"[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*"
_FENCE_OPEN = re.compile(rf"^{_CONTAINER}(?P<run>`{{3,}}|~{{3,}})(?P<info>.*)$")
_FENCE_CLOSE = re.compile(r"^[ \t]*(?:>[ \t]*)*(?P<run>`{3,}|~{3,})[ \t]*$")
_REFERENCE_DEFINITION = re.compile(r"^[ \t]*(?:>[ \t]*)*\[(?!\^)[^\]]+\]:")
#: What cannot continue a paragraph, so whatever was left open in it has ended.
_NEW_BLOCK = re.compile(r"^[ \t]*(?:#{1,6}[ \t]|(?:[-*+]|\d{1,9}[.)])[ \t])")
_INDENTED = re.compile(r"^(?: {4}| {0,3}\t)")
_TICKS = re.compile(r"`+")
_IN_BRACKETS = re.compile(r"\\[!-/:-@\[-`{-~]|`+|\[|\]")
_IN_TARGET = re.compile(r"\\[!-/:-@\[-`{-~]|\(|\)")

#: The next thing that matters in prose, leftmost first. Every repetition that could
#: restart at each position of a long line is bounded, so a line costs linear time.
_NEXT = re.compile(
    r"(?P<escape>\\[!-/:-@\[-`{-~])"
    r"|(?P<ticks>`+)"
    r"|(?P<bracket>\[)"
    r"|(?P<angle><[/!?]?[A-Za-z][^<>]*>|<!--.{0,4096}?-->)"
    r"|(?P<url>(?<!\w)(?:[A-Za-z][A-Za-z0-9+.-]{0,31}://|www\.|mailto:)[^\s<>]*)"
    r"|(?P<host>(?<![\w.-])[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/[^\s<>]*)"
    rf"|{_BEFORE}(?P<item>{HUMAN_ID_SHAPE}){_AFTER}"
)


class Mention(NamedTuple):
    start: int
    end: int
    reference: str


@dataclass(slots=True)
class ScanState:
    """What one message's scan knows between lines. Counters only, never its text."""

    fence_char: str = ""
    fence_length: int = 0
    #: The length of the backtick run an open code span waits for, 0 outside one.
    ticks: int = 0
    #: How many `[` and how many `(` of a link target are open.
    brackets: int = 0
    parens: int = 0
    #: No paragraph is open, so an indented line here is code rather than a continuation.
    between_blocks: bool = True
    #: The batch the next call must be, so a batch this scan never saw is noticed.
    next_index: int = 0
    #: A batch ended inside a line, which the client's contract says only the last does.
    broken: bool = False

    def end_paragraph(self) -> None:
        self.ticks = self.brackets = self.parens = 0


def _inline_open(state: ScanState) -> bool:
    return bool(state.ticks or state.brackets or state.parens)


def _in_target(line: str, position: int, state: ScanState) -> int:
    """Past the target's closing parenthesis, or the end of the line while it is open."""

    while state.parens:
        found = _IN_TARGET.search(line, position)
        if found is None:
            return len(line)
        position = found.end()
        if found.group() == "(":
            state.parens += 1
        elif found.group() == ")":
            state.parens -= 1
    return position


def _in_brackets(line: str, position: int, state: ScanState) -> int:
    """Past the `]` that closes the brackets, or where a code span or target took over."""

    while state.brackets:
        found = _IN_BRACKETS.search(line, position)
        if found is None:
            return len(line)
        position = found.end()
        text = found.group()
        if text == "[":
            state.brackets += 1
        elif text == "]":
            state.brackets -= 1
            if state.brackets == 0 and line[position : position + 1] == "(":
                state.parens = 1
                return position + 1
            if state.brackets == 0 and line[position : position + 1] == "[":
                state.brackets = 1
                position += 1
        elif text.startswith("`"):
            state.ticks = len(text)
            return position
    return position


def _in_code_span(line: str, position: int, state: ScanState) -> int:
    """Past the run that closes the span, or the end of the line while it is open."""

    for run in _TICKS.finditer(line, position):
        if len(run.group()) == state.ticks:
            state.ticks = 0
            return run.end()
    return len(line)


def _scan_inline(line: str, offset: int, state: ScanState, found: list[Mention]) -> None:
    position = 0
    while position < len(line):
        if state.ticks:
            position = _in_code_span(line, position, state)
        elif state.parens:
            position = _in_target(line, position, state)
        elif state.brackets:
            position = _in_brackets(line, position, state)
        else:
            match = _NEXT.search(line, position)
            if match is None:
                return
            position = match.end()
            kind = match.lastgroup
            if kind == "ticks":
                state.ticks = len(match.group())
            elif kind == "bracket":
                state.brackets = 1
            elif kind == "item":
                found.append(
                    Mention(offset + match.start(), offset + match.end(), match.group("item"))
                )


def _scan_line(line: str, offset: int, state: ScanState, found: list[Mention]) -> None:
    if state.fence_length:
        closing = _FENCE_CLOSE.match(line)
        if closing is not None:
            run = closing.group("run")
            if run[0] == state.fence_char and len(run) >= state.fence_length:
                state.fence_char, state.fence_length = "", 0
                state.between_blocks = True
        return
    if not line.strip():
        state.end_paragraph()
        state.between_blocks = True
        return
    if state.between_blocks and _INDENTED.match(line) is not None:
        return
    opening = _FENCE_OPEN.match(line)
    if opening is not None:
        run = opening.group("run")
        if run[0] == "~" or "`" not in opening.group("info"):
            state.end_paragraph()
            state.fence_char, state.fence_length = run[0], len(run)
            state.between_blocks = False
            return
    state.between_blocks = False
    if _NEW_BLOCK.match(line) is not None:
        state.end_paragraph()
    if not _inline_open(state) and _REFERENCE_DEFINITION.match(line) is not None:
        return
    _scan_inline(line, offset, state, found)


def scan(text: str, state: ScanState, *, final: bool) -> list[Mention]:
    """The mentions in this batch, in order, moving *state* past it.

    A batch that is not the message's last and stops inside a line breaks the
    client's stated contract, so nothing can be known about what continues it: the
    unfinished line and everything after it stay as they are. That is also what
    happens to a reference a batch boundary cuts through: both halves are shown as
    they were sent.
    """

    if state.broken:
        return []
    found: list[Mention] = []
    position = 0
    while position < len(text):
        newline = text.find("\n", position)
        if newline < 0:
            if not final:
                state.broken = True
                return found
            _scan_line(text[position:], position, state, found)
            break
        line = text[position : newline + 1].rstrip("\r\n")
        _scan_line(line, position, state, found)
        position = newline + 1
    return found


def with_links(text: str, mentions: list[Mention], url_of: dict[str, str]) -> str:
    """*text* with each mention *url_of* holds as a link, and every other character as it was."""

    parts: list[str] = []
    position = 0
    for mention in mentions:
        url = url_of.get(mention.reference)
        if url is None:
            continue
        parts += (text[position : mention.start], f"[{mention.reference}]({url})")
        position = mention.end
    parts.append(text[position:])
    return "".join(parts)
