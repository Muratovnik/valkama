"""The owner's names for accounts and their organizations, by key.

The usage rows and the quota samples hold ids and nothing that names them, so the owner
names them: Settings writes the name here, and every reader takes it from here — the
Analytics page on any device, and the quota alert text (`alerts.quota`).

A key is what is named:

- an account, by its key (`accounts.Account.key`): its organization, a slash, and its
  UUID or `weekly:` with the time of week its week resets;
- an organization, by its id alone. Its name labels the organization, its work no sample
  places on an account, and each of its accounts that has no name of its own.

An account known by its UUID also answers to the name given to the weekly reset its
readings without a UUID are known by (`own_name`), so a name given before the UUID turned
up stays with it.

A name is held to the rule the web app writes it by: one line, its runs of spaces and line
breaks collapsed to one space and its ends trimmed, at most `MAX_NAME_LENGTH` characters
after that. A name over the bound is refused, never cut; an empty one means none. A key is
1 to `MAX_KEY_LENGTH` characters with no NUL, and one with a slash is an account's key
(`accounts.is_account_key`). A write that breaks either rule is refused whole and changes
nothing.

A write either replaces what is there, or, with `replace` false, gives a name only to a
key that has none: what a device that kept names of its own uses to move them here once
without overwriting a name given since.
"""

from __future__ import annotations

import json
import sqlite3
import unicodedata
from collections.abc import Iterable, Mapping
from datetime import UTC, datetime

from . import accounts
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
_DELETE = "DELETE FROM quota_account_names WHERE account = ?"
_READ = "SELECT account, name FROM quota_account_names ORDER BY account"
_READ_OF = (
    "SELECT account, name FROM quota_account_names"
    " WHERE account IN (SELECT value FROM json_each(?))"
)


class NamesError(ValueError):
    """A write this build does not accept, with the reason."""


def _text(value: str) -> bool:
    """No lone surrogate: what the store can encode as UTF-8."""

    return not any(unicodedata.category(character) == "Cs" for character in value)


def clean(value: str) -> str:
    """A name as it is said: one line with its spaces collapsed; empty for none."""

    return " ".join(value.split())


def _key(value: object) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= MAX_KEY_LENGTH:
        raise NamesError(f"a key is 1 to {MAX_KEY_LENGTH} characters of text")
    if "\0" in value or not _text(value):
        raise NamesError("a key holds no NUL and no unpaired surrogate")
    if "/" in value and not accounts.is_account_key(value):
        raise NamesError(
            f"{value} is neither an organization nor an account: an account's key is its"
            " organization, a slash, and its UUID or weekly:<weekday>T<HH:MM>Z"
        )
    return value


def _name(key: str, value: object) -> str:
    if not isinstance(value, str):
        raise NamesError(f"the name of {key} must be text; an empty one clears it")
    said = clean(value)
    if len(said) > MAX_NAME_LENGTH:
        raise NamesError(
            f"the name of {key} is {len(said)} characters; a name is at most {MAX_NAME_LENGTH}"
        )
    if not _text(said) or any(unicodedata.category(character) == "Cc" for character in said):
        raise NamesError(f"the name of {key} holds a control character")
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
        raise NamesError("names must be an object of names by account or organization")
    if len(given) > MAX_NAMES_PER_WRITE:
        raise NamesError(f"one write names at most {MAX_NAMES_PER_WRITE} accounts")
    names: dict[str, str] = {}
    for key, value in given.items():
        named = _key(key)
        names[named] = _name(named, value)
    return names, replace


def read(conn: sqlite3.Connection) -> dict[str, str]:
    """Every name the owner gave, by key."""

    return {str(key): str(name) for key, name in conn.execute(_READ)}


def names_of(conn: sqlite3.Connection, keys: Iterable[str]) -> dict[str, str]:
    """The names of these keys, by key; one with no name is not in it.

    One query whatever the number asked for, so a reader of many accounts asks once.
    """

    wanted = sorted(set(keys))
    if not wanted:
        return {}
    return {str(key): str(name) for key, name in conn.execute(_READ_OF, (json.dumps(wanted),))}


def keys_of(account: accounts.Account) -> tuple[str, ...]:
    """Every key whose name an account's label may take: its own, the weekly reset an
    account known by its UUID is known by without one, and its organization."""

    found = [account.key]
    if account.account_uuid is not None and account.weekly_reset is not None:
        found.append(accounts.Account(account.organization, None, account.weekly_reset).key)
    return (*found, account.organization)


def own_name(named: Mapping[str, str], account: accounts.Account) -> str | None:
    """The name the owner gave the account itself, from names read for `keys_of` it: under
    its key, or for an account known by its UUID, under its weekly reset's."""

    for key in keys_of(account)[:-1]:
        if key in named:
            return named[key]
    return None


def write(conn: sqlite3.Connection, payload: object) -> dict[str, str]:
    """Validate and store the names, commit, and answer every name now stored.

    An empty name takes the key's name away. With `replace` false, a name is stored only
    where the key has none, so an empty one changes nothing.
    """

    names, replace = validate(payload)
    now = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    try:
        for key, name in names.items():
            if not name:
                if replace:
                    conn.execute(_DELETE, (key,))
                continue
            conn.execute(_REPLACE if replace else _KEEP, (key, name, now))
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
    "keys_of",
    "names_of",
    "own_name",
    "read",
    "validate",
    "write",
]
