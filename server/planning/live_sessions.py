"""The sessions the live-work frame lists beside its items: those at work or waiting on no row.

A session that works on an item is seen through that item's row. One that was given a
prompt and works on nothing the frame draws, or waits for a person there, would
otherwise show nowhere, and most sessions never write to an item. `listed` gives each
a row of its own:

| Field | Says |
|---|---|
| `session` | its id, which opens it |
| `title` | the name its client gave it, or null when there is none to read |
| `folder` | the last part of the folder it was opened in, or empty |
| `state` | `working` or `waiting`, as `live_work` reads the session |
| `long` | whether it has waited for longer than `live_work.WAITING_LONG` |
| `asks` | whether it waits for a person in the middle of a turn, not after one |
| `agents` | how many live subagents it has |
| `since` | when what it is doing now began; only its own lifecycle events move it |
| `executor` | where it is open and whose settings cover it, as a card's holder has |

A session is listed when it is active, was heard from within `live_work.LIVE_QUIET`,
is at work or was ever given a prompt, and none of its work is a row of the frame. One
opened and left with no prompt waits for nobody and is not listed. The rows come
freshest first by `since`, and two of one second by id.

The title is the client's own: Claude Code writes the name it shows for a session into
that session's transcript, `ai-title` for the one it made and `custom-title` for the
one a person gave, which wins. It is the only thing read from a transcript's content
here, from the file's last `_TAIL_BYTES`, where the client writes it again with each
prompt. It may say what the person asked for, so it goes into the frame and nowhere
else: never into the store, a log line or a diagnostic. A file is read again only when
it changed, and then at most once in `_REREAD_SECONDS`, so a session at work costs the
status of its file on most frames. Another client's transcript is not read.
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
from collections.abc import Mapping
from dataclasses import dataclass

from .. import sessions
from . import live_work

_TAIL_BYTES = 1024 * 1024
_REREAD_SECONDS = 30.0
_TITLE_LENGTH = 200
_REMEMBERED = 256

#: The client's two records of a session's name, and the field of each that holds it.
_TITLE_FIELDS = {"custom-title": "customTitle", "ai-title": "aiTitle"}

_SESSIONS = (
    "SELECT id, client, opened_folder, cwd, transcript_path FROM sessions"
    " WHERE id IN (SELECT value FROM json_each(?))"
)


@dataclass(frozen=True)
class Listed:
    """One session's row, with the folder that says which space it is drawn under."""

    folder: str
    row: dict


@dataclass(frozen=True)
class _Read:
    """What one transcript said when it was last read, and what the file looked like then."""

    size: int
    written: int
    read_at: float
    title: str | None


_titles: dict[str, _Read] = {}


def _clock() -> float:
    return time.monotonic()


def _cleaned(value: object) -> str | None:
    """A title as one line of printable text, or None for anything that is no title."""

    if not isinstance(value, str):
        return None
    words = "".join(sign if sign.isprintable() else " " for sign in value).split()
    return " ".join(words)[:_TITLE_LENGTH] or None


def _title_in(tail: bytes) -> str | None:
    """The name a transcript's tail gives its session: the last a person gave, else the last made."""

    found: dict[str, str] = {}
    for line in tail.splitlines():
        if b"-title" not in line:
            continue
        try:
            record = json.loads(line)
        except ValueError:
            continue
        if not isinstance(record, dict):
            continue
        field = _TITLE_FIELDS.get(str(record.get("type")))
        title = _cleaned(record.get(field)) if field else None
        if field and title:
            found[field] = title
    return found.get("customTitle") or found.get("aiTitle")


def _title(path: str) -> str | None:
    """The session's name as its transcript has it now; the last one known when it says none."""

    if not path:
        return None
    known = _titles.get(path)
    try:
        status = os.stat(path)
    except (OSError, ValueError):
        return None if known is None else known.title
    now = _clock()
    if known is not None and (
        (known.size, known.written) == (status.st_size, status.st_mtime_ns)
        or now - known.read_at < _REREAD_SECONDS
    ):
        return known.title
    try:
        with open(path, "rb") as handle:
            handle.seek(max(0, status.st_size - _TAIL_BYTES))
            tail = handle.read(_TAIL_BYTES)
    except OSError:
        return None if known is None else known.title
    title = _title_in(tail) or (None if known is None else known.title)
    if len(_titles) >= _REMEMBERED and path not in _titles:
        _titles.clear()
    _titles[path] = _Read(status.st_size, status.st_mtime_ns, now, title)
    return title


def _folder_name(folder: str) -> str:
    return os.path.basename(folder.rstrip("\\/"))


def listed(
    conn: sqlite3.Connection,
    known: Mapping[str, live_work.SessionWork],
    rows: set[str],
    executor_of: Mapping[str, dict],
) -> list[Listed]:
    """The sessions to list, freshest first.

    `rows` are the items the frame draws, and `executor_of` the executor of each session
    of `known`, as `executors.session_executors` reads them.
    """

    apart = {
        session: work
        for session, work in known.items()
        if (work.prompted or work.state == live_work.WORKING) and not work.items & rows
    }
    if not apart:
        return []
    found: list[Listed] = []
    for row in conn.execute(_SESSIONS, (json.dumps(sorted(apart)),)):
        session = str(row["id"])
        work = apart[session]
        folder = str(row["opened_folder"] or row["cwd"] or "")
        claude = sessions.client_family(row["client"]) == "claude"
        found.append(
            Listed(
                folder,
                {
                    "session": session,
                    "title": _title(str(row["transcript_path"] or "")) if claude else None,
                    "folder": _folder_name(folder),
                    "state": work.state,
                    "long": work.long,
                    "asks": work.asks,
                    "agents": work.subagents,
                    "since": work.since,
                    "executor": executor_of[session],
                },
            )
        )
    found.sort(key=lambda entry: str(entry.row["session"]))
    found.sort(key=lambda entry: str(entry.row["since"]), reverse=True)
    return found
