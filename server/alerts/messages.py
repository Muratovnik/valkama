"""What an alert says: the event, the item and the settings in, one toast out.

A pure function. It reads nothing, starts nothing and knows no clock, so the
same event always produces the same toast, and the only test of the words is
this module's own.

The toast is built here, as text, and handed to `ops.toast` whole: the helper
that shows it only loads it. That puts the one place where store text meets
markup in Python, where `html.escape` turns the five characters markup is made
of into entities XML reads the same way -- so a title, a
question or a reference never changes the toast's structure -- and characters
XML 1.0 cannot carry at all are dropped rather than left to fail the load.

A click opens the item through `valkama://open/<REF>`, the scheme the desktop
app registers, as a protocol activation: it works after the process that showed
the toast has exited, which is the usual case, since that process is an agent's
session or a short-lived reaper pass.

`Tag` is the item's reference and `Group` is `valkama`, so a newer toast about
the same item replaces the older one in the action centre and either can be
removed by the pair.
"""

from __future__ import annotations

import html
import re
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import TypedDict

from ..ops.toast import AUMID

GROUP = "valkama"
#: The tag of a toast that stands for several items at once.
SUMMARY_TAG = "summary"
TITLE_LIMIT = 80
PROMPT_LIMIT = 120
_REFERENCES_LIMIT = 120

#: Everything XML 1.0 forbids in character data: C0 controls other than tab,
#: line feed and carriage return, lone surrogates, and the two non-characters.
_NOT_XML = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]")

_HEADINGS = {
    "ru": {
        "question": "Valkama: нужен ваш ответ",
        "decision": "Valkama: нужно решение",
        "review": "Valkama: задача на проверке",
        "launchFailed": "Valkama: запуск не удался",
        "summary": "Valkama: ждут вашего ответа: {count}",
        "open": "Открытых вопросов по задаче: {count}",
    },
    "en": {
        "question": "Valkama: your answer is needed",
        "decision": "Valkama: a decision is needed",
        "review": "Valkama: work is ready for review",
        "launchFailed": "Valkama: a launch failed",
        "summary": "Valkama: waiting for your answer: {count}",
        "open": "Open questions on this item: {count}",
    },
}
_EVENTS = ("question", "review", "launchFailed")
_KINDS = ("question", "decision")


class Message(TypedDict):
    """One toast, ready for `ops.toast.show`: the markup is final and escaped."""

    aumid: str
    tag: str
    group: str
    xml: str
    #: When Windows removes the toast from the action centre, as
    #: `YYYY-MM-DDTHH:MM:SSZ`, or None to leave that to Windows.
    expires_at: str | None


def launch_uri(reference: str) -> str:
    """The address a click on an item's toast opens."""

    return f"valkama://open/{reference}"


def _clean(text: str) -> str:
    return _NOT_XML.sub("", text)


def _one_line(text: str) -> str:
    return " ".join(_clean(text).split())


def _cut(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _first_line(text: str) -> str:
    for line in _clean(text).splitlines():
        if line.strip():
            return " ".join(line.split())
    return ""


def _phrases(settings: Mapping[str, object]) -> dict[str, str]:
    language = settings.get("locale")
    if not isinstance(language, str) or language not in _HEADINGS:
        raise ValueError(f"no alert texts for the language {language!r}")
    return _HEADINGS[language]


def _expiry(value: str | None) -> str | None:
    if value is None:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("an alert's expiry must name its time zone")
    return parsed.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _attribute(value: str) -> str:
    return f'"{html.escape(value, quote=True)}"'


def _toast(launch: str, lines: Sequence[str], logo: str | None) -> str:
    image = f'<image placement="appLogoOverride" src={_attribute(logo)}/>' if logo else ""
    text = "".join(f"<text>{html.escape(line, quote=False)}</text>" for line in lines)
    return (
        f'<toast launch={_attribute(launch)} activationType="protocol">'
        f'<visual><binding template="ToastGeneric">{text}{image}</binding></visual>'
        "</toast>"
    )


def build(
    event: str,
    *,
    reference: str,
    title: str,
    settings: Mapping[str, object],
    kind: str | None = "question",
    open_questions: int = 1,
    prompt: str = "",
    expires_at: str | None = None,
    logo: str | None = None,
) -> Message:
    """The toast for one event on one item.

    `event` is one of `alerts.settings.EVENTS`; `kind` is the question's kind
    and matters only for a `question`. `open_questions` counts the item's open
    questions, this one included, and is shown only when there are several.
    `prompt` is the question's text, of which the first non-blank line is shown
    under `content: prompt`. `expires_at` is the question's deadline, any ISO
    timestamp with a zone. `logo` is a `file:` URI for the toast's logo, or None.

    Only `settings["content"]` and `settings["locale"]` are read.
    """

    if event not in _EVENTS:
        raise ValueError(f"no alert for the event {event!r}")
    if event == "question" and kind not in _KINDS:
        raise ValueError(f"no alert for a question of kind {kind!r}")
    phrases = _phrases(settings)
    content = settings.get("content")
    lines = [phrases[kind if event == "question" and kind else event]]
    if content in ("title", "prompt"):
        lines.append(f"{_clean(reference)} · {_cut(_one_line(title), TITLE_LIMIT)}")
        if content == "prompt":
            first = _cut(_first_line(prompt), PROMPT_LIMIT)
            if first:
                lines.append(first)
        elif open_questions > 1:
            lines.append(phrases["open"].format(count=open_questions))
    elif content != "generic":
        raise ValueError(f"no alert content {content!r}")
    return {
        "aumid": AUMID,
        "tag": reference,
        "group": GROUP,
        "xml": _toast(launch_uri(reference), lines, logo),
        "expires_at": _expiry(expires_at),
    }


def summary(
    references: Sequence[str], *, settings: Mapping[str, object], logo: str | None = None
) -> Message:
    """One toast for several items that came due together, oldest first.

    A click opens the newest. Under `content: generic` the items go unnamed.
    """

    if not references:
        raise ValueError("a summary needs at least one item")
    phrases = _phrases(settings)
    lines = [phrases["summary"].format(count=len(references))]
    if settings.get("content") != "generic":
        lines.append(
            _cut(", ".join(_clean(reference) for reference in references), _REFERENCES_LIMIT)
        )
    return {
        "aumid": AUMID,
        "tag": SUMMARY_TAG,
        "group": GROUP,
        "xml": _toast(launch_uri(references[-1]), lines, logo),
        "expires_at": None,
    }
