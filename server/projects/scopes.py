"""Attachable database files, so unrelated work can live in unrelated stores.

One store per scope: personal, work, or a project file kept beside the
repository it belongs to. A card lives in exactly one file — federation is a
read-time union, never a write path, so there is no dual write to reconcile and
detaching a file simply removes its scope from every view (ADR 0008, decision 5).

Work-scope data may fall under an NDA or contain personal data, which is why
this is file-level separation the owner can physically detach rather than a flag
inside one shared database.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3

REGISTRY_NAME = "scopes.json"
# The store that existed before federation. It is always present, always first,
# and is never migrated: it simply becomes the first scope.
PRIMARY_SCOPE = "personal"
NAME_PATTERN = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
DEFAULT_STREAM_RETENTION_DAYS = 14


class ScopeError(ValueError):
    """The registry, or a requested scope, cannot be used as asked."""


def _state_directory(primary_db: str) -> str:
    return os.path.dirname(os.path.abspath(primary_db))


def registry_path(primary_db: str) -> str:
    return os.path.join(_state_directory(primary_db), REGISTRY_NAME)


def _validate_entry(entry: object) -> dict:
    if not isinstance(entry, dict):
        raise ScopeError("a scope entry must be an object")
    name = str(entry.get("name", "")).strip().lower()
    if NAME_PATTERN.fullmatch(name) is None:
        raise ScopeError(f"scope name {name!r} must be lowercase letters, digits and dashes")
    path = str(entry.get("path", "")).strip()
    if not path or not os.path.isabs(path):
        raise ScopeError(f"scope {name!r} needs an absolute database path")
    retention = entry.get("stream_retention_days", DEFAULT_STREAM_RETENTION_DAYS)
    if type(retention) is not int or retention < 0:
        raise ScopeError(f"scope {name!r} retention must be a nonnegative integer")
    return {
        "name": name,
        "path": os.path.abspath(path),
        "stream_retention_days": retention,
        "label": str(entry.get("label", "")).strip()[:60] or name,
    }


def load(primary_db: str) -> list[dict]:
    """Every scope, primary first. A missing registry means only the primary."""
    primary_path = os.path.abspath(primary_db)
    primary = {
        "name": PRIMARY_SCOPE,
        "path": primary_path,
        "stream_retention_days": DEFAULT_STREAM_RETENTION_DAYS,
        "label": PRIMARY_SCOPE,
        "primary": True,
    }
    path = registry_path(primary_db)
    if not os.path.isfile(path):
        return [primary]
    try:
        with open(path, encoding="utf-8") as handle:
            document = json.load(handle)
    except (OSError, json.JSONDecodeError) as error:
        raise ScopeError(f"cannot read the scope registry: {error}") from error
    if not isinstance(document, dict) or not isinstance(document.get("scopes"), list):
        raise ScopeError("the scope registry must be an object with a scopes array")
    entries = [_validate_entry(item) for item in document["scopes"]]
    names = {PRIMARY_SCOPE}
    paths = {primary_path.lower()}
    scopes = [primary]
    for entry in entries:
        if entry["name"] in names:
            raise ScopeError(f"duplicate scope name {entry['name']!r}")
        if entry["path"].lower() in paths:
            raise ScopeError(f"scope {entry['name']!r} points at an already attached file")
        names.add(entry["name"])
        paths.add(entry["path"].lower())
        entry["primary"] = False
        scopes.append(entry)
    return scopes


def save(primary_db: str, scopes: list[dict]) -> str:
    """Write the non-primary scopes; the primary is implicit, never listed."""
    payload = {
        "scopes": [
            {
                "name": scope["name"],
                "path": scope["path"],
                "label": scope.get("label", scope["name"]),
                "stream_retention_days": scope.get(
                    "stream_retention_days", DEFAULT_STREAM_RETENTION_DAYS
                ),
            }
            for scope in scopes
            if scope["name"] != PRIMARY_SCOPE
        ]
    }
    path = registry_path(primary_db)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    os.replace(temporary, path)
    return path


def attach(primary_db: str, name: str, path: str, label: str = "") -> list[dict]:
    scopes = load(primary_db)
    entry = _validate_entry({"name": name, "path": path, "label": label})
    if entry["name"] == PRIMARY_SCOPE:
        raise ScopeError(f"{PRIMARY_SCOPE!r} is the primary scope and is always attached")
    if any(scope["name"] == entry["name"] for scope in scopes):
        raise ScopeError(f"scope {entry['name']!r} is already attached")
    if any(scope["path"].lower() == entry["path"].lower() for scope in scopes):
        raise ScopeError("that database file is already attached under another name")
    entry["primary"] = False
    scopes.append(entry)
    save(primary_db, scopes)
    return scopes


def detach(primary_db: str, name: str) -> list[dict]:
    """Remove a scope from every view. The file itself is left untouched."""
    name = str(name).strip().lower()
    if name == PRIMARY_SCOPE:
        raise ScopeError(f"{PRIMARY_SCOPE!r} is the primary scope and cannot be detached")
    scopes = load(primary_db)
    remaining = [scope for scope in scopes if scope["name"] != name]
    if len(remaining) == len(scopes):
        raise ScopeError(f"no attached scope named {name!r}")
    save(primary_db, remaining)
    return remaining


def find(primary_db: str, name: str) -> dict:
    name = str(name).strip().lower() or PRIMARY_SCOPE
    for scope in load(primary_db):
        if scope["name"] == name:
            return scope
    raise ScopeError(f"no attached scope named {name!r}")


def open_readonly(scope: dict) -> sqlite3.Connection:
    """Read a scope without creating or upgrading it.

    A file that is missing or not a board store is reported by the caller as an
    unavailable scope, never as a crash: an external drive can be unplugged.
    """
    if not os.path.isfile(scope["path"]):
        raise ScopeError(f"scope {scope['name']!r} file is not present: {scope['path']}")
    uri = "file:" + scope["path"].replace("?", "%3f").replace("#", "%23") + "?mode=ro"
    connection = sqlite3.connect(uri, uri=True, timeout=5)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("SELECT 1 FROM planning_spaces LIMIT 1")
    except sqlite3.Error as error:
        connection.close()
        raise ScopeError(f"scope {scope['name']!r} is not a Valkama store: {error}") from error
    return connection


def qualified(scope_name: str, reference: str) -> str:
    """A work item identity that stays unique once two stores are read together."""
    return f"{scope_name}#{reference}"


def split_qualified(value: str) -> tuple[str, str]:
    scope_name, separator, raw = str(value).partition("#")
    if not separator or not raw.strip():
        raise ScopeError(f"{value!r} is not a scope-qualified work item reference")
    return scope_name.strip().lower(), raw.strip().upper()
