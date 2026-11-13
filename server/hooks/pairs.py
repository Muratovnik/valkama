"""Which session made a Claude Code tool call: the pair its `PreToolUse` hook leaves.

Claude Code tells a hook the call's `tool_use_id`, its session and, inside a
subagent, the agent, and repeats the `tool_use_id` to the MCP server in
`_meta["claudecode/toolUseId"]`. So the hook leaves one file per call, named by
that id and holding what `_identity` used to carry, and the server reads the file
of the call it is handling. The hook changes nothing in the call: a hook that
rewrites a call's input makes auto mode withhold its verdict from every other
call in the same response.

A file, not a store row. The hook runs on every Valkama call, reads included, and
must stay as cheap as it was: a row would make it wait for another writer, spool
when the store is busy (and a spooled pair arrives after the call it names), and
move `PRAGMA data_version` on every read, waking every watcher and stream.

There is no race to wait out. Claude Code sends the call only after the hook has
exited, and the hook makes the file visible with one rename before it exits, so a
pair that is not there when the call arrives is not coming.

The server deletes a pair when it takes it. A pair no call took, because the call
was refused, interrupted or arrived without the key, stays until a server prunes
pairs older than `STALE_SECONDS`, at most once every `PRUNE_EVERY_SECONDS`.

This module imports only `os`, because the hook loads it on every call.
"""

from __future__ import annotations

import os

#: The pairs' directory, beside the store, so it follows `VALKAMA_DB` the way
#: the spool does.
DIRECTORY = "calls"
SUFFIX = ".json"
_TEMPORARY = ".tmp"

#: A pair older than this names a call that never came, and is deleted.
STALE_SECONDS = 3600
#: How often one server process looks for such pairs.
PRUNE_EVERY_SECONDS = 600
#: A pair older than this that is still there was not taken by its call: the
#: call is handled within a second of its hook, so `doctor` counts it.
UNCLAIMED_SECONDS = 60

#: The most a pair file is read; one is about two hundred bytes.
_MAX_BYTES = 4096
_ID_LIMIT = 128
_ID_CHARACTERS = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-")

#: When this process last pruned, by `time.monotonic`; None before the first time.
_pruned_at: float | None = None


def directory(store_path: str) -> str:
    """The pairs beside one store."""

    return os.path.join(os.path.dirname(os.path.abspath(store_path)), DIRECTORY)


def plain(tool_use_id: str) -> bool:
    """Whether an id can name a file as it is. Claude Code's ids are `toolu_` and base62."""

    return 0 < len(tool_use_id) <= _ID_LIMIT and set(tool_use_id) <= _ID_CHARACTERS


def write(store_path: str, tool_use_id: str, content: bytes) -> str | None:
    """Leave one pair and return its file, or None for an id that cannot name one.

    The file appears whole or not at all. Only `calls/` is created, and only in
    a store directory that exists: whether that directory exists is how the first
    full open tells that no store from an earlier product name is waiting to be
    adopted (see `spool.write_line`).
    """

    if not plain(tool_use_id):
        return None
    parent = os.path.dirname(os.path.abspath(store_path))
    if not os.path.isdir(parent):
        return None
    folder = os.path.join(parent, DIRECTORY)
    try:
        os.mkdir(folder)
    except FileExistsError:
        pass
    final = os.path.join(folder, tool_use_id + SUFFIX)
    temporary = os.path.join(folder, f".{tool_use_id}.{os.getpid()}{_TEMPORARY}")
    with open(temporary, "wb") as handle:
        handle.write(content)
    os.replace(temporary, final)
    return final


def take(store_path: str, tool_use_id: str, *, now: float, monotonic: float) -> object | None:
    """The pair the hook left for this call, parsed but not validated; None when there is none.

    The file is deleted once read: a call is made once. `now` is the wall clock
    a pair's age is read against, `monotonic` what the pruning interval is.
    """

    global _pruned_at

    if _pruned_at is None or monotonic - _pruned_at >= PRUNE_EVERY_SECONDS:
        _pruned_at = monotonic
        prune(store_path, now=now)
    if not plain(tool_use_id):
        return None
    path = os.path.join(directory(store_path), tool_use_id + SUFFIX)
    try:
        with open(path, "rb") as handle:
            data = handle.read(_MAX_BYTES + 1)
    except OSError:
        return None
    _remove(path)
    if len(data) > _MAX_BYTES:
        return None
    import json

    try:
        return json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None


def prune(store_path: str, *, now: float) -> int:
    """Delete pairs and leftover temporary files older than `STALE_SECONDS`; how many."""

    removed = 0
    for path, age in _ages(directory(store_path), now):
        if age > STALE_SECONDS and _remove(path):
            removed += 1
    return removed


def summary(store_path: str, *, now: float) -> dict:
    """What `doctor` reports: pairs older than `UNCLAIMED_SECONDS`, and the newest one's age."""

    ages = [
        age
        for path, age in _ages(directory(store_path), now)
        if path.endswith(SUFFIX) and age > UNCLAIMED_SECONDS
    ]
    return {"unclaimed": len(ages), "newest_age_seconds": int(min(ages)) if ages else None}


def _ages(folder: str, now: float) -> list[tuple[str, float]]:
    try:
        entries = list(os.scandir(folder))
    except OSError:
        return []
    found = []
    for entry in entries:
        if not entry.name.endswith((SUFFIX, _TEMPORARY)):
            continue
        try:
            found.append((entry.path, now - entry.stat().st_mtime))
        except OSError:
            continue
    return found


def _remove(path: str) -> bool:
    """Delete one file; false when it is gone or held (Windows refuses while it is open)."""

    try:
        os.remove(path)
    except OSError:
        return False
    return True
