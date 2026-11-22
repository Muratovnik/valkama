"""Where one recipient's notices stand: the marks file its hook keeps.

A recipient is one session's orchestrator or one of its agents. Its hook
(`notify`) keeps a small file beside the store, `notify/<session>[--<agent>].marks`,
holding per item the last call it has read there, and the close guard
(`planning.transitions`) reads the same file to learn what that hook has already
told the agent closing an item: a person's words the hook handed over need no
second write to count as heard. The hook is the only writer; the server only reads.

What a line holds, and how each older layout reads, is `read_state`'s to say. A
file that is missing, cannot be read or does not parse is no file to the guard
(`parse` answers None), and an empty one to the hook, which rewrites it whole at
its next write.

This module imports only `os` at module level: the hook loads it on every tool
call, and the guard on every agent's close.
"""

from __future__ import annotations

import os

#: The hook's files, beside the store, so they follow `VALKAMA_DB` as the spool does.
STATE_DIRECTORY = "notify"
SUFFIX = ".marks"

_FILE_SAFE = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-")
#: The most of a marks file read; one line per item, at most `notify.MOST_ITEMS` of them.
_MAX_BYTES = 1 << 20

#: Per item: the last call read, the signature then (revision, newest event, newest
#: comment, the blockers' newest event), whether it was held, the last call whose other
#: sessions' news was read, and whether some of it still waits.
Mark = tuple[int, tuple[int, int, int, int], bool, int, bool]

#: The wakes other sessions' news made, as whole seconds of the clock, the newest
#: hour's; how many events the limit held back since a notice last said so; the
#: newest call those were read to, past which nothing held back wakes again; and per
#: item, the times of the notices that quoted other sessions' news on it within
#: `notify.FOLD_WINDOW_SECONDS`.
Budget = tuple[tuple[int, ...], int, int, dict[str, tuple[int, ...]]]
NO_BUDGET: Budget = ((), 0, 0, {})


def directory(store: str) -> str:
    """The hook's files beside one store; whether it exists is the caller's to ask."""

    return os.path.join(os.path.dirname(os.path.abspath(store)), STATE_DIRECTORY)


def _file_key(value: str) -> str:
    if 0 < len(value) <= 128 and all(ch in _FILE_SAFE for ch in value):
        return value
    import hashlib

    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:32]


def recipient_key(session_id: str, agent_id: str | None) -> str:
    """The name one recipient's files share: its session, and its agent when it has one."""

    key = _file_key(session_id)
    return f"{key}--{_file_key(agent_id)}" if agent_id else key


def path(state: str, session_id: str, agent_id: str | None) -> str:
    """One recipient's marks file in the hook's directory `state`."""

    return os.path.join(state, recipient_key(session_id, agent_id) + SUFFIX)


def read_marks(path: str) -> dict[str, Mark]:
    """Per item, where this recipient's news stands; or empty. See `read_state`."""

    return read_state(path)[0]


def read_state(path: str) -> tuple[dict[str, Mark], Budget]:
    """Per item, where this recipient's news stands, and its wakes; or both empty.

    A `v1` file, from before an item could be marked without being held, holds only
    held items. Read as empty, it would tell every running session old news once.
    A `v1` or `v2` file, from before agents' mentions, has read those as far as
    everything else and has none waiting, for the same reason. A file from before
    `v4` kept no blockers' event: an item that has a blocker is read once more,
    from its place, which tells nothing again.

    A `v4` file may carry the wake budget in `@wakes` and `@held` lines, and an
    item's quoting notices in an `@told <item>` line. Damaged, the whole file reads
    as empty: the news since the recipient's own last writes is told once more, and
    wakes at most once more, and the next write is whole.
    """

    return parse(path) or ({}, NO_BUDGET)


def parse(path: str) -> tuple[dict[str, Mark], Budget] | None:
    """What the file at `path` holds, or None when it is missing, unreadable or damaged."""

    try:
        with open(path, "rb") as handle:
            lines = handle.read(_MAX_BYTES).decode("ascii").splitlines()
    except (OSError, UnicodeDecodeError):
        return None
    fields = {"v1": 5, "v2": 6, "v3": 8, "v4": 9}.get(lines[0]) if lines else None
    if fields is None:
        return None
    marks = {}
    wakes: tuple[int, ...] = ()
    held = through = 0
    told: dict[str, tuple[int, ...]] = {}
    for line in lines[1:]:
        parts = line.split()
        if fields == 9 and len(parts) > 2 and parts[0] == "@told":
            parts = parts[1:]
            if not all(part.isdigit() for part in parts[1:]):
                return None
            told[parts[0]] = tuple(int(part) for part in parts[1:])
            continue
        if not all(part.isdigit() for part in parts[1:]):
            return None
        if fields == 9 and parts and parts[0] == "@wakes":
            wakes = tuple(int(part) for part in parts[1:])
            continue
        if fields == 9 and len(parts) == 3 and parts[0] == "@held":
            held, through = int(parts[1]), int(parts[2])
            continue
        if len(parts) != fields:
            return None
        numbers = [int(part) for part in parts[1:]]
        if fields == 9:
            signature = (numbers[1], numbers[2], numbers[3], numbers[4])
            del numbers[4]
        else:
            signature = (numbers[1], numbers[2], numbers[3], 0)
        holds = fields == 5 or numbers[4] == 1
        heard, waiting = (numbers[5], numbers[6] == 1) if fields >= 8 else (numbers[0], False)
        marks[parts[0]] = (numbers[0], signature, holds, heard, waiting)
    return marks, (wakes, held, through, told)


def write_marks(path: str, marks: dict[str, Mark], budget: Budget = NO_BUDGET) -> None:
    wakes, held, through, told = budget
    lines = ["v4"]
    if wakes:
        lines.append(" ".join(["@wakes", *(str(at) for at in wakes)]))
    if held or through:
        lines.append(f"@held {held} {through}")
    lines += [
        " ".join(["@told", item, *(str(at) for at in times)])
        for item, times in sorted(told.items())
        if times and item in marks
    ]
    lines += [
        f"{item} {mark} {signature[0]} {signature[1]} {signature[2]} {signature[3]}"
        f" {int(held)} {heard} {int(waiting)}"
        for item, (mark, signature, held, heard, waiting) in sorted(marks.items())
    ]
    # Imported here: only a call with something to write loads it. Another hook of this
    # recipient may be reading the file outside the lock, and the rename waits that reader
    # out. A file lost to a crash reads as empty, so the bytes are not forced to disk.
    from .. import atomic_files

    atomic_files.write(path, ("\n".join(lines) + "\n").encode("ascii"), durable=False)


def told_through(
    store: str, session_id: str, agent_id: str | None, work_item_id: str
) -> int | None:
    """The last call through which this recipient's hook told it all a person did on an item.

    None when the recipient keeps no marks file that reads: a client without the
    hook, notices switched off, or a damaged file. Zero when the file reads but
    holds no place on this item that covers everything: the hook never read it, or
    last read it while the recipient did not hold it, and then it told only what
    was addressed to the recipient, so its place there says nothing about the rest.
    """

    found = parse(path(directory(store), session_id, agent_id))
    if found is None:
        return None
    mark = found[0].get(work_item_id)
    return mark[0] if mark is not None and mark[2] else 0
