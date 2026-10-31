"""From one client hook input to what Valkama keeps, and nothing else.

Pure: no file, no store, no clock. The caller supplies the event's uid and the
moment it happened, so a direct write and a spooled line carry the same values.

What is kept is an allowlist. A hook input can hold the user's prompt, a tool's
arguments, the last assistant message, or Codex turn metadata that names
workspaces and remote URLs; none of those is ever read here, so none of them
can reach the store or the spool.

The module also builds the Claude `PreToolUse` identity output, which runs on
every Valkama tool call and must stay this cheap.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import asdict, dataclass

#: The command's two arguments, `valkama hook <client> <event>`, mapped to the
#: client's own hook name and the kind Valkama records. The event names are the
#: client's hook names in kebab case.
LIFECYCLE_EVENTS: dict[str, tuple[str, str]] = {
    "session-start": ("SessionStart", "session_start"),
    "session-end": ("SessionEnd", "session_end"),
    "subagent-start": ("SubagentStart", "subagent_start"),
    "subagent-stop": ("SubagentStop", "subagent_stop"),
    "stop": ("Stop", "turn_end"),
    "user-prompt-submit": ("UserPromptSubmit", "prompt"),
    "pre-compact": ("PreCompact", "compact"),
    "notification": ("Notification", "attention"),
}

#: Which lifecycle events each client has. Codex has no `Notification`.
CLIENT_EVENTS: dict[str, frozenset[str]] = {
    "claude": frozenset(LIFECYCLE_EVENTS),
    "codex": frozenset(LIFECYCLE_EVENTS) - {"notification"},
}

#: The identity transform's event, and the clients it is for. Codex carries the
#: same identity in every call's `_meta`, so it needs no transform.
IDENTITY_EVENT = "pre-tool-use"
IDENTITY_CLIENTS = frozenset({"claude"})

#: The kind each client hook name records, for a reader that validates a stored line.
_KIND_OF_HOOK = dict(LIFECYCLE_EVENTS.values())

#: The longest value kept per field. A longer one is treated as not reported
#: rather than cut: a truncated id or path names something else.
LIMITS = {
    "session_id": 128,
    "agent_id": 128,
    "agent_type": 128,
    "turn_id": 128,
    "permission_mode": 32,
    "model": 128,
    "source": 32,
    "reason": 64,
    "cwd": 4096,
    "transcript_path": 4096,
    "agent_transcript_path": 4096,
}

#: Fields read from every lifecycle input; `turn_id` is filled from Codex
#: `turn_id` or Claude `prompt_id`.
_COMMON = (
    "session_id",
    "agent_id",
    "agent_type",
    "permission_mode",
    "model",
    "cwd",
    "transcript_path",
)
#: Fields read from one kind's input only.
_PER_KIND = {
    "session_start": ("source",),
    "session_end": ("reason",),
    "subagent_stop": ("agent_transcript_path",),
}
_PATHS = ("cwd", "transcript_path", "agent_transcript_path")

#: The spool line format this build writes and reads.
SPOOL_VERSION = 1

_TIMESTAMP = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z")
_UID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


@dataclass(frozen=True)
class HookEvent:
    """One lifecycle event, normalized: the only shape that is stored or spooled."""

    event_uid: str
    occurred_at: str
    client: str
    hook_event: str
    kind: str
    session_id: str
    agent_id: str | None = None
    agent_type: str | None = None
    turn_id: str | None = None
    permission_mode: str | None = None
    model: str | None = None
    source: str | None = None
    reason: str | None = None
    cwd: str | None = None
    transcript_path: str | None = None
    agent_transcript_path: str | None = None


_FIELDS = frozenset(HookEvent.__dataclass_fields__)
_SPOOL_ONLY = frozenset({"v", "spooled_at", "spool_reason"})


def timestamp(nanoseconds: int) -> str:
    """UTC with milliseconds, the format `execution_events` stores."""

    seconds, rest = divmod(nanoseconds, 1_000_000_000)
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(seconds)) + f".{rest // 1_000_000:03d}Z"


def parse_input(raw: bytes) -> dict | None:
    """The hook input as an object, or nothing when it is not one."""

    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def _text(value: object, field: str) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = "".join(ch for ch in value if ch >= " " and ch != "\x7f").strip()
    if field in _PATHS:
        cleaned = normalize_path(cleaned)
    if not cleaned or len(cleaned) > LIMITS[field]:
        return None
    return cleaned


def normalize_path(path: str) -> str:
    r"""Drop the Windows extended-length prefix a client sometimes adds after a resume.

    `\\?\C:\x` names `C:\x`, and `\\?\UNC\host\share` names `\\host\share`.
    """

    if path.startswith("\\\\?\\UNC\\"):
        return "\\\\" + path[len("\\\\?\\UNC\\") :]
    if path.startswith("\\\\?\\"):
        return path[len("\\\\?\\") :]
    return path


def lifecycle_event(
    client: str, event: str, payload: dict, *, event_uid: str, occurred_at: str
) -> HookEvent | None:
    """The kept fields of one lifecycle hook input, or nothing to record.

    Nothing is recorded for an event this client does not have, for input that
    names a different hook than the command line does, or without a session id:
    an event that cannot be attributed to a session is not evidence of one.
    """

    if event not in CLIENT_EVENTS.get(client, frozenset()):
        return None
    hook_event, kind = LIFECYCLE_EVENTS[event]
    named = payload.get("hook_event_name")
    if named is not None and named != hook_event:
        return None
    fields: dict[str, str | None] = {
        field: _text(payload.get(field), field) for field in (*_COMMON, *_PER_KIND.get(kind, ()))
    }
    session_id = fields.pop("session_id")
    if session_id is None:
        return None
    fields["turn_id"] = _text(
        payload.get("turn_id" if client == "codex" else "prompt_id"), "turn_id"
    )
    return HookEvent(
        event_uid=event_uid,
        occurred_at=occurred_at,
        client=client,
        hook_event=hook_event,
        kind=kind,
        session_id=session_id,
        **fields,
    )


def spool_line(record: HookEvent, *, spooled_at: str, reason: str) -> bytes:
    """One spool line: the normalized event plus when and why it was spooled."""

    line = {"v": SPOOL_VERSION, **asdict(record), "spooled_at": spooled_at, "spool_reason": reason}
    return json.dumps(line, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"


def read_spool_line(line: dict) -> tuple[HookEvent, str] | None:
    """A stored line back as the event and its `spooled_at`, or nothing if invalid.

    The file is read back from disk, so it is checked as strictly as a hook
    input is: a known version, known keys only, and every value of the shape
    `lifecycle_event` produces.
    """

    if line.get("v") != SPOOL_VERSION or not set(line) <= _FIELDS | _SPOOL_ONLY:
        return None
    spooled_at = line.get("spooled_at")
    if not isinstance(spooled_at, str) or not _TIMESTAMP.fullmatch(spooled_at):
        return None
    if not isinstance(line.get("spool_reason"), str):
        return None
    values = {key: value for key, value in line.items() if key in _FIELDS}
    try:
        record = HookEvent(**values)
    except TypeError:
        return None
    if not _UID.fullmatch(str(record.event_uid)) or not _TIMESTAMP.fullmatch(
        str(record.occurred_at)
    ):
        return None
    if record.client not in CLIENT_EVENTS or _KIND_OF_HOOK.get(record.hook_event) != record.kind:
        return None
    for field, limit in LIMITS.items():
        value = getattr(record, field)
        if value is None and field != "session_id":
            continue
        if not isinstance(value, str) or not value or len(value) > limit:
            return None
    return record, spooled_at


def identity_output(payload: dict) -> dict | None:
    """The Claude `PreToolUse` output that adds `_identity` to an MCP call, or nothing.

    `updatedInput` replaces the whole input, so it is the original arguments
    with `_identity` added; an `_identity` the model wrote itself is replaced.
    No `permissionDecision` is returned: rewriting the input does not need one,
    and returning `allow` would skip a permission prompt the user configured.
    Anything malformed gives nothing, and the call then proceeds unconfirmed.
    """

    if payload.get("hook_event_name", "PreToolUse") != "PreToolUse":
        return None
    tool_name = payload.get("tool_name")
    if not isinstance(tool_name, str) or not tool_name.startswith("mcp__"):
        return None
    arguments = payload.get("tool_input")
    if not isinstance(arguments, dict):
        return None
    identity: dict[str, str] = {}
    for field in ("session_id", "tool_use_id"):
        value = payload.get(field)
        if not isinstance(value, str) or not value:
            return None
        identity[field] = value
    for field in ("agent_id", "agent_type"):
        value = payload.get(field)
        if isinstance(value, str) and value:
            identity[field] = value
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "updatedInput": {**arguments, "_identity": identity},
        }
    }
