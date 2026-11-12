"""The owner's quota settings: their shape, their defaults and their row.

One setting so far, `poll`: whether the listener polls the usage endpoint for the
subscription quota (`quota.poll`). It is off on a clean install and stays off until the
owner of the installation switches it on, because the endpoint is undocumented and
Anthropic's terms do not explicitly permit this use of it; the Settings page says so beside
the switch.

A payload is held to an exact shape, as the alert settings are: an unknown key is refused,
a missing one takes its default, and a stored row that no longer passes the check reads as
the defaults.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import TypedDict

_ROW_KEY = "poll"


class Settings(TypedDict):
    poll: bool


class SettingsError(ValueError):
    """A settings payload this build does not accept, with the reason."""


DEFAULTS: Settings = {"poll": False}


def validate(payload: object) -> Settings:
    """The complete settings a payload asks for, or `SettingsError`."""

    if not isinstance(payload, Mapping):
        raise SettingsError("quota settings must be an object")
    unknown = sorted(str(key) for key in payload if key not in DEFAULTS)
    if unknown:
        raise SettingsError(f"unknown quota setting: {', '.join(unknown)}")
    poll = payload.get("poll", DEFAULTS["poll"])
    if not isinstance(poll, bool):
        raise SettingsError("poll must be true or false")
    return {"poll": poll}


def read(conn: sqlite3.Connection) -> Settings:
    """The settings in force: the stored row, or the defaults when there is none."""

    row = conn.execute("SELECT record_json FROM quota_settings WHERE key=?", (_ROW_KEY,)).fetchone()
    if row is not None:
        try:
            return validate(json.loads(str(row[0])))
        except (ValueError, TypeError):
            pass  # a row no longer valid reads as the defaults, as the module says
    return validate({})


def write(conn: sqlite3.Connection, payload: object) -> Settings:
    """Validate and store the settings, commit, and answer what was stored."""

    settings = validate(payload)
    conn.execute(
        "INSERT INTO quota_settings(key,record_json,updated_at) VALUES(?,?,?)"
        " ON CONFLICT(key) DO UPDATE SET"
        " record_json=excluded.record_json, updated_at=excluded.updated_at",
        (
            _ROW_KEY,
            json.dumps(settings, sort_keys=True, separators=(",", ":")),
            datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        ),
    )
    conn.commit()
    return settings


__all__ = ["DEFAULTS", "Settings", "SettingsError", "read", "validate", "write"]
