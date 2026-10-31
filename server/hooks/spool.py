"""The spool: hook events the store could not take yet, one file per emitter.

It lives in `spool/` beside the store, so it follows `VALKAMA_DB` the way the
backups do. Each hook process writes its own file under a temporary name and
renames it into place, so a reader never sees half a line and two hooks never
append to one file.

A pending file ends in `.jsonl` and is named `<occurred_ns>-<event_uid>.jsonl`,
so the directory listing is the delivery order. A file that cannot be read back
is renamed `.rejected`: kept for a person to read, counted by `doctor`, and
never retried.
"""

from __future__ import annotations

import json
import os

from .normalize import HookEvent, read_spool_line, spool_line, timestamp

PENDING_SUFFIX = ".jsonl"
REJECTED_SUFFIX = ".rejected"


def directory(store_path: str) -> str:
    """The spool beside one store."""

    return os.path.join(os.path.dirname(os.path.abspath(store_path)), "spool")


def write(spool: str, record: HookEvent, *, occurred_ns: int, spooled_at: str, reason: str) -> str:
    """Spool one event and return its file. The file appears whole or not at all."""

    os.makedirs(spool, exist_ok=True)
    name = f"{occurred_ns:020d}-{record.event_uid}{PENDING_SUFFIX}"
    final = os.path.join(spool, name)
    temporary = os.path.join(spool, f".{name}.tmp")
    with open(temporary, "xb") as handle:
        handle.write(spool_line(record, spooled_at=spooled_at, reason=reason))
    os.replace(temporary, final)
    return final


def pending(spool: str) -> list[str]:
    """The pending files, oldest first."""

    try:
        names = os.listdir(spool)
    except OSError:
        return []
    return sorted(name for name in names if name.endswith(PENDING_SUFFIX))


def read(path: str) -> list[tuple[HookEvent, str]] | None:
    """Every event in one file with its `spooled_at`, or nothing if any line is invalid.

    One bad line rejects the file: a file is the unit that is delivered and
    deleted, so delivering half of it would leave the rest nowhere.
    """

    with open(path, "rb") as handle:
        data = handle.read()
    events: list[tuple[HookEvent, str]] = []
    for raw in data.splitlines():
        if not raw.strip():
            continue
        try:
            line = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            return None
        event = read_spool_line(line) if isinstance(line, dict) else None
        if event is None:
            return None
        events.append(event)
    return events or None


def reject(path: str) -> bool:
    """Set one unreadable file aside; false when another process holds or took it."""

    try:
        os.replace(path, path[: -len(PENDING_SUFFIX)] + REJECTED_SUFFIX)
    except OSError:
        return False
    return True


def remove(path: str) -> None:
    """Delete a delivered file.

    One another drain removed first is already done. One that cannot be removed
    now (Windows refuses while another process reads it) stays pending, and the
    next drain replays it as no-ops.
    """

    try:
        os.remove(path)
    except OSError:
        pass


def summary(spool: str) -> dict:
    """What `doctor` reports: pending files, the oldest one's time, rejected files."""

    try:
        names = os.listdir(spool)
    except OSError:
        names = []
    waiting = sorted(name for name in names if name.endswith(PENDING_SUFFIX))
    oldest = None
    for name in waiting:
        prefix = name.partition("-")[0]
        if prefix.isdigit():
            oldest = timestamp(int(prefix))
            break
    return {
        "pending": len(waiting),
        "oldest": oldest,
        "rejected": sum(1 for name in names if name.endswith(REJECTED_SUFFIX)),
    }
