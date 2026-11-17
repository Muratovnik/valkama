"""Commit records: what the Git hook leaves for a client hook to take into the store.

`valkama git-hook run` runs inside a Git command an agent's shell started, where
the store may be closed to it, and it must cost the commit as little as it can.
So it does not write the store: it leaves one JSON file per hook run and per
client session it found in the environment, and the client's own hook, which
runs after that shell call, takes it into the store (`planning.commits`).

A file is named `<session key>--<nanoseconds>-<16 hex>.json`. The key is the one
the notice's place files use (`file_key`), so a client hook finds the records of
its own session with one `os.scandir` and opens no other. When the environment
names two sessions, a client started from another one's shell, the same record
is written twice, one file per key, with one time and one hex part: whichever
client hook takes it first records the commit, and the other file then changes
nothing and is deleted.

Where. Beside the store, in `commits/`, when the store's file is there and the
directory takes the file. Otherwise in `<common Git directory>/valkama/commits/`
of the repository committed to, which is writable whenever the commit itself
succeeded. That place is inside the Git directory, not the work tree: no commit
and no `git status` sees it. A store the configuration protects
(`VALKAMA_PROTECTED_STORE`) gets no record anywhere.

Which records a client hook takes is `taken`: a Codex hook the ones whose
`tool_call_id` is its `tool_use_id`, a Claude Code hook on its shell tools the
ones written within the call's duration, and any hook of the session the ones
nobody took for eleven minutes. The planning sweep takes the rest after an hour
(`planning.commits.sweep`), and sets aside in `rejected/` a file it could not
read for a week.

This module imports only `os` at load: the Git hook runs it on every commit an
agent makes, and the client hook on every tool call. JSON comes in through the
caller's `loads`, the C scanner the notice already reads its input with.
"""

from __future__ import annotations

import os

TYPE_CHECKING = False
if TYPE_CHECKING:
    from collections.abc import Callable, Iterable, Mapping

FORMAT = "valkama-commit-record"
VERSION = 1
#: Beside the store, next to `spool/` and `calls/`.
DIRECTORY = "commits"
#: Under the common Git directory of the repository, when the store's place takes nothing.
FALLBACK = ("valkama", "commits")
SUFFIX = ".json"
_TEMPORARY = ".tmp"
_SEPARATOR = "--"
_HEX = frozenset("0123456789abcdef")
#: The most a record file is read: a rebase of many commits is one record.
MAX_BYTES = 1024 * 1024

#: The shell tools of Claude Code a commit is made in, whose hook takes records by time.
WINDOW_TOOLS = frozenset({"Bash", "PowerShell"})
#: What a Claude Code window adds before the call's start for the clocks of two processes.
WINDOW_SLACK_NS = 2_000_000_000
#: The window when the input carries no `duration_ms`: the longest a shell call may take
#: by default (`BASH_MAX_TIMEOUT_MS`).
DEFAULT_WINDOW_NS = 600_000_000_000
#: How old a record no hook took is when any next hook of its session takes it as a
#: leftover: past the longest default window, and a minute more.
LEFTOVER_NS = 660_000_000_000
#: Where the sweep moves a record it could not read for a week, beside the records.
REJECTED = "rejected"

REWRITES = (None, "amend", "rebase")

_FILE_SAFE = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-")


def file_key(value: str) -> str:
    """A session or agent id as a file name carries it: as it is when it is plain, or hashed."""

    if 0 < len(value) <= 128 and all(ch in _FILE_SAFE for ch in value):
        return value
    import hashlib

    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:32]


def encode(value: object) -> bytes:
    """A record as compact ASCII JSON, without loading `json`, whose decoder loads `re`.

    A record holds objects, lists, text, integers and nulls only.
    """

    try:
        from _json import encode_basestring_ascii as quoted
    except ImportError:
        import json

        return json.dumps(value, separators=(",", ":")).encode("ascii")

    def part(item: object) -> str:
        if item is None:
            return "null"
        if isinstance(item, bool):
            return "true" if item else "false"
        if isinstance(item, int):
            return str(item)
        if isinstance(item, str):
            return quoted(item)
        if isinstance(item, list):
            return "[" + ",".join(part(entry) for entry in item) + "]"
        if isinstance(item, dict):
            return "{" + ",".join(f"{quoted(str(k))}:{part(v)}" for k, v in item.items()) + "}"
        raise TypeError(f"a record holds no {type(item).__name__}")

    return part(value).encode("ascii")


def timestamp(nanoseconds: int) -> str:
    """UTC with milliseconds, as `execution_events` stores a time."""

    import time

    seconds, rest = divmod(nanoseconds, 1_000_000_000)
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(seconds)) + f".{rest // 1_000_000:03d}Z"


# --- the registry ------------------------------------------------------------


def registry_path(environ: Mapping[str, str] | None = None) -> str:
    """The registry's one path: `project_registry.registry_path`, held equal by a test."""

    source = os.environ if environ is None else environ
    local = source.get("LOCALAPPDATA")
    if local:
        return os.path.join(local, "Valkama", "projects.json")
    return os.path.join(os.path.expanduser("~"), "AppData", "Local", "Valkama", "projects.json")


def registry_roots(
    loads: Callable[[str], object], environ: Mapping[str, str] | None = None
) -> list[tuple[str, str]]:
    """Each registered project's id and root, read as a file; none when it cannot be read.

    Only what a record needs is read: the full validation stays with
    `projects.project_registry`, whose import a hook does not pay for.
    """

    try:
        with open(registry_path(environ), "rb") as handle:
            raw = handle.read(MAX_BYTES + 1)
    except OSError:
        return []
    if len(raw) > MAX_BYTES:
        return []
    try:
        document = loads(raw.decode("utf-8"))
    except UnicodeDecodeError:
        return []
    if not isinstance(document, dict) or document.get("schema_version") != 4:
        return []
    projects = document.get("projects")
    if not isinstance(projects, list):
        return []
    found = []
    for entry in projects:
        if isinstance(entry, dict):
            project_id, root = entry.get("project_id"), entry.get("canonical_root")
            if isinstance(project_id, str) and isinstance(root, str) and os.path.isabs(root):
                found.append((project_id, root))
    return found


def _same_path(path: str) -> str:
    return os.path.normcase(os.path.normpath(os.path.abspath(path)))


def project_of(root: str, projects: Iterable[tuple[str, str]]) -> str | None:
    """The registered project whose root is exactly `root`, without case on Windows."""

    wanted = _same_path(root)
    for project_id, canonical_root in projects:
        if _same_path(canonical_root) == wanted:
            return project_id
    return None


# --- places ------------------------------------------------------------------


def store_directory(store_path: str) -> str:
    """The records beside one store."""

    return os.path.join(os.path.dirname(os.path.abspath(store_path)), DIRECTORY)


def fallback_directory(common_dir: str) -> str:
    """The records inside one repository's common Git directory."""

    return os.path.join(common_dir, *FALLBACK)


def own_fallbacks(projects: Iterable[tuple[str, str]]) -> list[str]:
    """The fallback places of the registered projects that have a `.git` directory of their own."""

    found = []
    for _project_id, root in projects:
        git = os.path.join(root, ".git")
        if os.path.isdir(git):
            found.append(fallback_directory(git))
    return found


def places(store_path: str, common_dir: str) -> list[tuple[str, bool]]:
    """Where the Git hook tries to leave a record, in order, and whether it may create the
    directory's parent there too.

    Beside the store only when the store's file is there: the hook creates no
    directory but `commits/` itself, and never a store directory, whose absence is
    how the first full open tells that no store from an earlier product name waits
    to be adopted (see `spool.write_line`).
    """

    found = []
    if os.path.isfile(store_path):
        found.append((store_directory(store_path), False))
    found.append((fallback_directory(common_dir), True))
    return found


def _ensure(directory: str, with_parent: bool) -> None:
    if with_parent:
        try:
            os.mkdir(os.path.dirname(directory))
        except FileExistsError:
            pass
    try:
        os.mkdir(directory)
    except FileExistsError:
        pass


def write(
    content: bytes, keys: Iterable[str], where: Iterable[tuple[str, bool]], occurred_ns: int
) -> list[str]:
    """Leave one file per key in the first place that takes them all; the files written.

    Each appears whole or not at all: it is written under a temporary name in the
    same directory and moved into place. A place that refuses one of them keeps
    none, and the next is tried.
    """

    stem = f"{occurred_ns}-{os.urandom(8).hex()}"
    names = [f"{file_key(key)}{_SEPARATOR}{stem}{SUFFIX}" for key in dict.fromkeys(keys)]
    for directory, with_parent in where:
        written: list[str] = []
        try:
            _ensure(directory, with_parent)
            for name in names:
                final = os.path.join(directory, name)
                temporary = os.path.join(directory, f".{name}.{os.getpid()}{_TEMPORARY}")
                with open(temporary, "wb") as handle:
                    handle.write(content)
                os.replace(temporary, final)
                written.append(final)
        except OSError:
            for path in written:
                remove(path)
            continue
        return written
    return []


# --- reading -----------------------------------------------------------------


def occurred_ns(name: str, key: str) -> int | None:
    """The time in a record file's name when the file is one of `key`'s, else None."""

    named = name_parts(name)
    return named[1] if named is not None and named[0] == key else None


def name_parts(name: str) -> tuple[str, int] | None:
    """The session key and the time a record file's name carries, or None for another file."""

    # The last separator: a session key may hold one, the time and the hex part do not.
    key, separator, rest = name.rpartition(_SEPARATOR)
    if not (key and separator and rest.endswith(SUFFIX)):
        return None
    time_part, dash, hex_part = rest[: -len(SUFFIX)].partition("-")
    if not (dash and time_part.isdigit() and len(hex_part) == 16 and set(hex_part) <= _HEX):
        return None
    return key, int(time_part)


def scan(directories: Iterable[str], key: str) -> list[tuple[int, str]]:
    """The record files of one session key in these directories, oldest first."""

    found = []
    for directory in directories:
        try:
            entries = list(os.scandir(directory))
        except OSError:
            continue
        for entry in entries:
            at = occurred_ns(entry.name, key)
            if at is not None:
                found.append((at, entry.path))
    found.sort()
    return found


def every(directories: Iterable[str]) -> list[tuple[int, str, str]]:
    """Every record file in these directories, oldest first: its time, session key and path."""

    found = []
    for directory in directories:
        try:
            entries = list(os.scandir(directory))
        except OSError:
            continue
        for entry in entries:
            named = name_parts(entry.name)
            if named is not None and entry.is_file():
                found.append((named[1], named[0], entry.path))
    found.sort()
    return found


def reject(path: str) -> bool:
    """Move a record that cannot be read into `rejected/` beside it; false when it is gone."""

    directory = os.path.join(os.path.dirname(path), REJECTED)
    try:
        _ensure(directory, False)
        os.replace(path, os.path.join(directory, os.path.basename(path)))
    except OSError:
        return False
    return True


def _text(value: object, limit: int = 4096) -> bool:
    return isinstance(value, str) and 0 < len(value) <= limit


def _hash(value: object) -> bool:
    return isinstance(value, str) and len(value) in (40, 64) and set(value) <= _HEX


def _session(value: object, keys: tuple[str, ...]) -> bool:
    if value is None:
        return True
    if not isinstance(value, dict) or set(value) != set(keys) or not _text(value.get(keys[0])):
        return False
    return all(value[key] is None or _text(value[key]) for key in keys[1:])


def valid(record: object) -> bool:
    """Whether a parsed file is a record of this format and version, whole."""

    if not isinstance(record, dict) or record.get("format") != FORMAT:
        return False
    if record.get("version") != VERSION:
        return False
    commits, rewritten = record.get("commits"), record.get("rewritten")
    if not (
        _text(record.get("event"), 64)
        and _text(record.get("root"))
        and _text(record.get("project_id"), 160)
        and _text(record.get("occurred_at"), 64)
        and record.get("rewrite") in REWRITES
        and isinstance(commits, list)
        and isinstance(rewritten, list)
        and _session(record.get("claude"), ("session_id",))
        and _session(record.get("codex"), ("session_id", "thread_id", "tool_call_id"))
        and (record.get("claude") is not None or record.get("codex") is not None)
    ):
        return False
    for commit in commits:
        if not (
            isinstance(commit, dict)
            and _hash(commit.get("hash"))
            and isinstance(commit.get("parents"), list)
            and all(_hash(parent) for parent in commit["parents"])
            and isinstance(commit.get("subject"), str)
            and (commit.get("committed_at") is None or _text(commit.get("committed_at"), 64))
        ):
            return False
    return all(
        isinstance(pair, dict) and _hash(pair.get("from")) and _hash(pair.get("to"))
        for pair in rewritten
    )


def read(path: str, loads: Callable[[str], object]) -> dict | None:
    """One record, or None when the file is gone, too large or not a record."""

    try:
        with open(path, "rb") as handle:
            raw = handle.read(MAX_BYTES + 1)
    except OSError:
        return None
    if len(raw) > MAX_BYTES:
        return None
    try:
        record = loads(raw.decode("utf-8"))
    except UnicodeDecodeError:
        return None
    return record if valid(record) and isinstance(record, dict) else None


def remove(path: str) -> bool:
    """Delete one record; false when it is gone already, or held. Two processes may both try."""

    try:
        os.remove(path)
    except OSError:
        return False
    return True


# --- which records a client hook takes -----------------------------------------


def _window(payload: Mapping[str, object]) -> int:
    duration = payload.get("duration_ms")
    if isinstance(duration, (int, float)) and not isinstance(duration, bool) and duration >= 0:
        return int(duration * 1_000_000) + WINDOW_SLACK_NS
    return DEFAULT_WINDOW_NS


def record_directories(
    store_path: str, loads: Callable[[str], object], environ: Mapping[str, str] | None = None
) -> list[str]:
    """Where records may wait: beside the store, and in each registered project's Git."""

    return [store_directory(store_path), *own_fallbacks(registry_roots(loads, environ))]


def taken(
    client: str,
    payload: Mapping[str, object],
    store_path: str,
    loads: Callable[[str], object],
    now_ns: int,
    environ: Mapping[str, str] | None = None,
) -> list[tuple[str, dict, bool]]:
    """The records this hook call takes, oldest first, each with its file and whether it
    is a leftover.

    - Codex: the records of its session whose `tool_call_id` is the input's
      `tool_use_id`, the call the commit was made in.
    - Claude Code, on `Bash` or `PowerShell`: the records of its session written
      within `duration_ms` of now, and the slack; without it, within the longest
      a shell call takes by default.
    - Leftovers, on any call of either client: the records of its session no hook
      took for `LEFTOVER_NS`, a background command's or one that outlasted its
      window. Which agent made them is not known, so the session decides.

    Nothing is opened but the directory listings, the registry and, for a
    candidate, its own file.
    """

    session = payload.get("session_id")
    if not _text(session, 256) or not isinstance(session, str):
        return []
    call: object = None
    earliest: int | None = None
    if client == "codex":
        call = payload.get("tool_use_id") if _text(payload.get("tool_use_id"), 256) else None
    elif client == "claude":
        if payload.get("tool_name") in WINDOW_TOOLS:
            earliest = now_ns - _window(payload)
    else:
        return []
    found = []
    for at, path in scan(record_directories(store_path, loads, environ), file_key(session)):
        windowed = earliest is not None and earliest <= at <= now_ns
        left = at <= now_ns - LEFTOVER_NS
        if not (windowed or left or (call is not None and at <= now_ns)):
            continue
        record = read(path, loads)
        own = record.get(client) if record is not None else None
        if record is None or not isinstance(own, dict) or own.get("session_id") != session:
            continue
        if windowed or (call is not None and own.get("tool_call_id") == call):
            found.append((path, record, False))
        elif left:
            found.append((path, record, True))
    return found
