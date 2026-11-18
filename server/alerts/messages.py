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
session or a short-lived reaper pass. A toast about a question asks for the question
too, `valkama://open/<REF>?reveal=question`, which is what it was shown for. A toast
that stands for several questions, and the trial, open `valkama://open/questions`, the
panel that lists them.

`Tag` is the item's reference and `Group` is `valkama`, so a newer toast about
the same item replaces the older one in the action centre and either can be
removed by the pair.

A toast about the quota (`quota`) is about no item, and the desktop app takes no
address of a quota screen, so it carries no click: what to do is in its text. Its tag
names the account's window, so the 90% toast of a week takes the place of the 75% one,
and it leaves the action centre at the window's reset, when it stops being true.
"""

from __future__ import annotations

import html
import math
import re
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import TypedDict

from ..ops.toast import AUMID

GROUP = "valkama"
#: The tag of a toast that stands for several items at once.
SUMMARY_TAG = "summary"
#: The word after `open/` that names the panel of open questions, and the id of the
#: header a summary carries. `desktop/open_path.js` takes it and no reference can be
#: spelled this way, because every reference ends in `-<number>`.
QUESTIONS = "questions"
#: What a click on a toast about a question adds to the item's address: the card opens
#: at the question still waiting. The toast does not name which: the card reads that as
#: it stands by then, and an answered one leaves the card simply opened.
REVEAL_QUESTION = "reveal=question"
#: The tag of the toast the settings screen sends to try the channel.
TRIAL_TAG = "trial"
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
        "attention": "Valkama: ждут вашего внимания: {count}",
        "panel": "Ждут моего ответа",
        "open": "Открытых вопросов по задаче: {count}",
        "trial": "Valkama: проверка оповещений",
        "trialLine": "Так выглядит оповещение Valkama.",
    },
    "en": {
        "question": "Valkama: your answer is needed",
        "decision": "Valkama: a decision is needed",
        "review": "Valkama: work is ready for review",
        "launchFailed": "Valkama: a launch failed",
        "summary": "Valkama: waiting for your answer: {count}",
        "attention": "Valkama: waiting for your attention: {count}",
        "panel": "Needs my answer",
        "open": "Open questions on this item: {count}",
        "trial": "Valkama: alert check",
        "trialLine": "This is what a Valkama alert looks like.",
    },
}
_EVENTS = ("question", "review", "launchFailed")
_KINDS = ("question", "decision")

_QUOTA = {
    "ru": {
        "week": "Valkama: недельная квота перешла {level}%",
        "week_model": "Valkama: недельная квота {model} перешла {level}%",
        "short": "Valkama: пятичасовая квота закончится около {at}",
        "spent": "Valkama: пятичасовая квота исчерпана",
        "state": "Израсходовано {percent}% · обновится {reset}",
        "today": "в {time}",
        "later": "{day} {month} в {time}",
        "now": "Данные получены только что.",
        "age": "Данные получены {minutes} мин назад.",
        "75": "Распределите остаток до конца недели или перенесите работу на другой аккаунт.",
        "90": "Оставьте остаток на самое нужное или перенесите работу на другой аккаунт.",
        "exhausted": "Сбавьте темп до обновления или перенесите работу на другой аккаунт.",
        "spentAction": "Дождитесь обновления или перенесите работу на другой аккаунт.",
    },
    "en": {
        "week": "Valkama: the week's quota passed {level}%",
        "week_model": "Valkama: the week's {model} quota passed {level}%",
        "short": "Valkama: the five-hour quota runs out at about {at}",
        "spent": "Valkama: the five-hour quota is spent",
        "state": "{percent}% used · resets {reset}",
        "today": "at {time}",
        "later": "on {month} {day} at {time}",
        "now": "Data from just now.",
        "age": "Data from {minutes} min ago.",
        "75": "Pace the rest of the week, or move work to another account.",
        "90": "Keep the rest for what matters most, or move work to another account.",
        "exhausted": "Slow down until the reset, or move work to another account.",
        "spentAction": "Wait for the reset, or move work to another account.",
    },
}
_MONTHS = {
    "ru": (
        "января",
        "февраля",
        "марта",
        "апреля",
        "мая",
        "июня",
        "июля",
        "августа",
        "сентября",
        "октября",
        "ноября",
        "декабря",
    ),
    "en": ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"),
}
#: The quota alert's levels by window: a week's share spent, or the five-hour window
#: forecast to run out before it resets.
_QUOTA_LEVELS = {"week": ("75", "90"), "week_model": ("75", "90"), "five_hour": ("exhausted",)}


class Message(TypedDict):
    """One toast, ready for `ops.toast.show`: the markup is final and escaped."""

    aumid: str
    tag: str
    group: str
    xml: str
    #: When Windows removes the toast from the action centre, as
    #: `YYYY-MM-DDTHH:MM:SSZ`, or None to leave that to Windows.
    expires_at: str | None


def launch_uri(reference: str, *, reveal_question: bool = False) -> str:
    """The address a click on an item's toast opens."""

    order = f"?{REVEAL_QUESTION}" if reveal_question else ""
    return f"valkama://open/{reference}{order}"


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


def _toast(
    launch: str | None, lines: Sequence[str], logo: str | None, header: str | None = None
) -> str:
    image = f'<image placement="appLogoOverride" src={_attribute(logo)}/>' if logo else ""
    text = "".join(f"<text>{html.escape(line, quote=False)}</text>" for line in lines)
    # The schema gives a header's own click the same two kinds of activation a toast has.
    head = (
        f"<header id={_attribute(QUESTIONS)} title={_attribute(header)}"
        f' arguments={_attribute(launch)} activationType="protocol"/>'
        if header and launch
        else ""
    )
    opens = f' launch={_attribute(launch)} activationType="protocol"' if launch else ""
    return (
        f"<toast{opens}>{head}"
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
        "xml": _toast(launch_uri(reference, reveal_question=event == "question"), lines, logo),
        "expires_at": _expiry(expires_at),
    }


def trial(settings: Mapping[str, object], logo: str | None = None) -> Message:
    """The toast that tries the channel. A click opens the panel: it is about no item."""

    phrases = _phrases(settings)
    return {
        "aumid": AUMID,
        "tag": TRIAL_TAG,
        "group": GROUP,
        "xml": _toast(launch_uri(QUESTIONS), [phrases["trial"], phrases["trialLine"]], logo),
        "expires_at": None,
    }


def summary(
    references: Sequence[str],
    *,
    questions: int,
    settings: Mapping[str, object],
    logo: str | None = None,
) -> Message:
    """One toast for several items that came due together, oldest first.

    `questions` counts those that wait on a question. With any, a click opens the panel
    that lists them; a toast for work on review or a failed launch has nothing to show
    there, so it opens the newest item and says attention rather than an answer. Under
    `content: generic` the items go unnamed.
    """

    if not references:
        raise ValueError("a summary needs at least one item")
    phrases = _phrases(settings)
    every_question = questions == len(references)
    lines = [phrases["summary" if every_question else "attention"].format(count=len(references))]
    if settings.get("content") != "generic":
        lines.append(
            _cut(", ".join(_clean(reference) for reference in references), _REFERENCES_LIMIT)
        )
    return {
        "aumid": AUMID,
        "tag": SUMMARY_TAG,
        "group": GROUP,
        "xml": _toast(
            launch_uri(QUESTIONS if questions else references[-1]),
            lines,
            logo,
            header=phrases["panel"] if questions else None,
        ),
        "expires_at": None,
    }


def _clock(value: datetime, now: datetime, language: str) -> str:
    """A time as the owner reads it: the clock alone today, the day and the clock later."""

    words = _QUOTA[language]
    time = value.strftime("%H:%M")
    if value.date() == now.date():
        return words["today"].format(time=time)
    month = _MONTHS[language][value.month - 1]
    return words["later"].format(day=value.day, month=month, time=time)


def quota(
    level: str,
    *,
    tag: str,
    window: str,
    percent: float,
    resets_at: datetime,
    sample_at: datetime,
    now: datetime,
    settings: Mapping[str, object],
    model: str | None = None,
    runs_out_at: datetime | None = None,
    account: str | None = None,
    logo: str | None = None,
) -> Message:
    """The toast that warns of one quota window running out.

    `window` is `week`, `week_model` (with `model`) or `five_hour`; `level` is `75` or
    `90` for a week and `exhausted` for the five-hour window, with `runs_out_at` when the
    forecast says when and without it when the window is spent already. `percent` is the
    share spent as the reading says, shown rounded down, so it never reads as a level it
    has not reached. The times are aware, in the zone to show them in; `now` is when the
    alert was decided and `sample_at` when the reading it rests on was made. `account` is
    the owner's name for the account, shown unless `content` is `generic`.

    Only `settings["content"]` and `settings["locale"]` are read.
    """

    if level not in _QUOTA_LEVELS.get(window, ()) or (window == "week_model") != bool(model):
        raise ValueError(f"no quota alert for {window!r} at {level!r}")
    _phrases(settings)  # refuses a language with no texts
    language = str(settings["locale"])
    words = _QUOTA[language]
    content = settings.get("content")
    if content not in ("generic", "title", "prompt"):
        raise ValueError(f"no alert content {content!r}")
    if window == "five_hour":
        heading = (
            words["spent"]
            if runs_out_at is None
            else words["short"].format(at=runs_out_at.strftime("%H:%M"))
        )
        action = words["spentAction" if runs_out_at is None else "exhausted"]
    else:
        heading = words[window].format(level=level, model=_one_line(model or ""))
        action = words[level]
    state = words["state"].format(
        percent=math.floor(percent), reset=_clock(resets_at, now, language)
    )
    if account and content != "generic":
        state = f"{_cut(_one_line(account), TITLE_LIMIT)} · {state}"
    minutes = max(0, int((now - sample_at).total_seconds() // 60))
    age = words["now"] if minutes == 0 else words["age"].format(minutes=minutes)
    return {
        "aumid": AUMID,
        "tag": tag,
        "group": GROUP,
        "xml": _toast(None, [heading, state, f"{age} {action}"], logo),
        "expires_at": _expiry(resets_at.isoformat()),
    }
