"""The owner's alert settings: their shape, their defaults and their one row.

The process that alerts is the one that wrote the event -- an agent's MCP
session, or the listener's reaper -- and never a page, so these settings live in
the store, in `owner_alert_settings`, rather than in a browser's storage. A store
without the row answers the defaults below.

A payload is held to an exact shape: an unknown key is refused rather than kept,
because a key nothing reads is a setting the owner believes in and nothing obeys;
a missing key takes its default. A stored row is read through the same check,
and one that fails it reads as the defaults: a broken row must not break the
write that wanted to alert.

The language a toast is written in is stored with the settings, from the
interface the owner used to save them. Until then it is the system's: Russian
when the Windows display language is, otherwise English -- the rule the desktop
start page uses.
"""

from __future__ import annotations

import json
import locale
import sqlite3
import sys
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from typing import TypedDict

#: The events an alert can be raised for. `question` is an agent's question or
#: decision; `review` is work moved to a review state; `launchFailed` is a launch
#: from Valkama that ended in failure.
EVENTS = ("question", "review", "launchFailed")
#: How much a toast reveals: only that an answer is needed, the item's number
#: and title, or those plus the first line of the question.
CONTENTS = ("generic", "title", "prompt")
LOCALES = ("ru", "en")

_EVENT_DEFAULTS = {"question": True, "review": True, "launchFailed": False}
_KEYS = ("enabled", "events", "content", "locale")
_ROW_KEY = "settings"
#: The primary language id Windows gives Russian, in the low ten bits of a LANGID.
_LANG_RUSSIAN = 0x19

LanguageProbe = Callable[[], str]


class Settings(TypedDict):
    enabled: bool
    events: dict[str, bool]
    content: str
    locale: str


class SettingsError(ValueError):
    """A settings payload this build does not accept, with the reason."""


def _windows_ui_language() -> int | None:
    """The user's Windows display language as a LANGID, or None when it cannot be read."""

    if sys.platform != "win32":
        return None
    import ctypes

    try:
        return int(ctypes.WinDLL("kernel32").GetUserDefaultUILanguage())
    except (AttributeError, OSError):
        return None


def system_language() -> str:
    """`ru` when the system speaks Russian, otherwise `en`."""

    if sys.platform == "win32":
        language_id = _windows_ui_language()
        return "ru" if language_id is not None and language_id & 0x3FF == _LANG_RUSSIAN else "en"
    name = locale.getlocale()[0] or ""
    return "ru" if name.lower().startswith("ru") else "en"


def _boolean(value: object, name: str) -> bool:
    if not isinstance(value, bool):
        raise SettingsError(f"{name} must be true or false")
    return value


def _choice(value: object, choices: tuple[str, ...], name: str) -> str:
    if not isinstance(value, str) or value not in choices:
        raise SettingsError(f"{name} must be one of {', '.join(choices)}")
    return value


def validate(payload: object, *, language: LanguageProbe = system_language) -> Settings:
    """The complete settings a payload asks for, or `SettingsError`.

    `language` answers the language when the payload names none; it is a probe
    rather than a value so a caller that names one never pays for the lookup.
    """

    if not isinstance(payload, Mapping):
        raise SettingsError("alert settings must be an object")
    unknown = sorted(str(key) for key in payload if key not in _KEYS)
    if unknown:
        raise SettingsError(f"unknown alert setting: {', '.join(unknown)}")
    events = dict(_EVENT_DEFAULTS)
    if "events" in payload:
        given = payload["events"]
        if not isinstance(given, Mapping):
            raise SettingsError("events must be an object")
        strange = sorted(str(key) for key in given if key not in EVENTS)
        if strange:
            raise SettingsError(f"unknown alert event: {', '.join(strange)}")
        for event, value in given.items():
            events[event] = _boolean(value, f"events.{event}")
    return {
        "enabled": _boolean(payload.get("enabled", True), "enabled"),
        "events": events,
        "content": _choice(payload.get("content", "title"), CONTENTS, "content"),
        "locale": _choice(payload["locale"], LOCALES, "locale")
        if "locale" in payload
        else _choice(language(), LOCALES, "locale"),
    }


def read(conn: sqlite3.Connection, *, language: LanguageProbe = system_language) -> Settings:
    """The settings in force: the stored row, or the defaults when there is none."""

    row = conn.execute(
        "SELECT record_json FROM owner_alert_settings WHERE key=?", (_ROW_KEY,)
    ).fetchone()
    if row is not None:
        try:
            return validate(json.loads(str(row[0])), language=language)
        except (ValueError, TypeError):
            pass  # a row no longer valid reads as the defaults, as the module says
    return validate({}, language=language)


def write(
    conn: sqlite3.Connection, payload: object, *, language: LanguageProbe = system_language
) -> Settings:
    """Validate and store the settings, commit, and answer what was stored.

    A refused payload writes nothing. Committing here follows the one other
    preference row the store keeps (`app_shell.save_ui_prefs`).
    """

    settings = validate(payload, language=language)
    conn.execute(
        "INSERT INTO owner_alert_settings(key,record_json,updated_at) VALUES(?,?,?)"
        " ON CONFLICT(key) DO UPDATE SET"
        " record_json=excluded.record_json, updated_at=excluded.updated_at",
        (
            _ROW_KEY,
            json.dumps(settings, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
            datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        ),
    )
    conn.commit()
    return settings


def wants(settings: Settings, event: str) -> bool:
    """Whether these settings ask for an alert on this event."""

    if event not in EVENTS:
        raise SettingsError(f"unknown alert event: {event}")
    return settings["enabled"] and settings["events"][event]
