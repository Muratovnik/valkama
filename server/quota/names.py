"""The owner's names for the accounts agent work was billed to, one per organization.

The usage rows and the quota samples hold an account's organization id and nothing that
names it, so the owner names it: Settings writes the name here, and every reader takes it
from here — the Analytics page on any device, and the quota alert text (`alerts.quota`).

A name is held to the rule the web app writes it by: one line, its runs of spaces and line
breaks collapsed to one space and its ends trimmed, at most `MAX_NAME_LENGTH` characters
after that. A name over the bound is refused, never cut; an empty one means none. An
organization is the id the usage read gives, 1 to `MAX_KEY_LENGTH` characters
with no NUL. A write that breaks either rule is refused whole and changes nothing.

A write either replaces what is there, or, with `replace` false, gives a name only to an
organization that has none: what a device that kept names of its own uses to move them
here once without overwriting a name given since.
"""

from __future__ import annotations

import json
import sqlite3
import unicodedata
from collections.abc import Iterable, Mapping
from datetime import UTC, datetime

from .store import MAX_KEY_LENGTH, MAX_NAME_LENGTH

#: How many names one write may carry: far more accounts than anyone bills work to.
MAX_NAMES_PER_WRITE = 1000
_KEYS = frozenset({"names", "replace"})
_INSERT = "INSERT INTO quota_account_names(account, name, updated_at) VALUES (?,?,?)"
#: A name that replaces the one there, and one kept only where there is none.
_REPLACE = (
    _INSERT + " ON CONFLICT(account) DO UPDATE SET"
    " name = excluded.name, updated_at = excluded.updated_at"
)
_KEEP = _INSERT + " ON CONFLICT(account) DO NOTHING"


class NamesError(ValueError):
    """A write this build does not accept, with the reason."""


def _text(value: str) -> bool:
    """No lone surrogate: what the store can encode as UTF-8."""

    return not any(unicodedata.category(character) == "Cs" for character in value)


def clean(value: str) -> str:
    """A name as it is said: one line with its spaces collapsed; empty for none."""

    return " ".join(value.split())


def _organization(value: object) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= MAX_KEY_LENGTH:
        raise NamesError(f"an organization is 1 to {MAX_KEY_LENGTH} characters of text")
    if "\0" in value or not _text(value):
        raise NamesError("an organization holds no NUL and no unpaired surrogate")
    return value


def _name(organization: str, value: object) -> str:
    if not isinstance(value, str):
        raise NamesError(f"the name of {organization} must be text; an empty one clears it")
    said = clean(value)
    if len(said) > MAX_NAME_LENGTH:
        raise NamesError(
            f"the name of {organization} is {len(said)} characters;"
            f" a name is at most {MAX_NAME_LENGTH}"
        )
    if not _text(said) or any(unicodedata.category(character) == "Cc" for character in said):
        raise NamesError(f"the name of {organization} holds a control character")
    return said


def validate(payload: object) -> tuple[dict[str, str], bool]:
    """The names a write asks for, cleaned, and whether it replaces; or `NamesError`."""

    if not isinstance(payload, Mapping):
        raise NamesError("a write of account names must be an object")
    unknown = sorted(str(key) for key in payload if key not in _KEYS)
    if unknown:
        raise NamesError(f"unknown field: {', '.join(unknown)}")
    replace = payload.get("replace", True)
    if not isinstance(replace, bool):
        raise NamesError("replace must be true or false")
    given = payload.get("names")
    if not isinstance(given, Mapping):
        raise NamesError("names must be an object of names by organization")
    if len(given) > MAX_NAMES_PER_WRITE:
        raise NamesError(f"one write names at most {MAX_NAMES_PER_WRITE} accounts")
    names: dict[str, str] = {}
    for key, value in given.items():
        organization = _organization(key)
        names[organization] = _name(organization, value)
    return names, replace


def read(conn: sqlite3.Connection) -> dict[str, str]:
    """Every name the owner gave, by organization."""

    return {
        str(organization): str(name)
        for organization, name in conn.execute(
            "SELECT account, name FROM quota_account_names ORDER BY account"
        )
    }


def names_of(conn: sqlite3.Connection, organizations: Iterable[str]) -> dict[str, str]:
    """The names of these organizations, by organization; one with no name is not in it.

    One query whatever the number asked for, so a reader of many accounts asks once.
    """

    wanted = sorted(set(organizations))
    if not wanted:
        return {}
    return {
        str(organization): str(name)
        for organization, name in conn.execute(
            "SELECT account, name FROM quota_account_names"
            " WHERE account IN (SELECT value FROM json_each(?))",
            (json.dumps(wanted),),
        )
    }


def write(conn: sqlite3.Connection, payload: object) -> dict[str, str]:
    """Validate and store the names, commit, and answer every name now stored.

    An empty name takes the organization's name away. With `replace` false, a name is
    stored only where the organization has none, so an empty one changes nothing.
    """

    names, replace = validate(payload)
    now = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    try:
        for organization, name in names.items():
            if not name:
                if replace:
                    conn.execute(
                        "DELETE FROM quota_account_names WHERE account = ?", (organization,)
                    )
                continue
            conn.execute(_REPLACE if replace else _KEEP, (organization, name, now))
    except BaseException:
        conn.rollback()
        raise
    conn.commit()
    return read(conn)


__all__ = [
    "MAX_KEY_LENGTH",
    "MAX_NAMES_PER_WRITE",
    "MAX_NAME_LENGTH",
    "NamesError",
    "clean",
    "names_of",
    "read",
    "validate",
    "write",
]
