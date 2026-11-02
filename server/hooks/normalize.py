"""From one client hook input to what Valkama keeps, and nothing else.

Pure: no file, no store, no clock. The caller supplies the event's uid and the
moment it happened, so a direct write and a spooled line carry the same values.

What is kept is an allowlist. A hook input can hold the user's prompt, a tool's
arguments, the last assistant message, or Codex turn metadata that names
workspaces and remote URLs; none of those is ever read here, so none of them
can reach the store or the spool. The one exception is named: the launch of an
agent keeps the short description of that call, and never its prompt.

The module also builds the Claude `PreToolUse` identity output, which runs on
every Valkama tool call and must stay this cheap.
"""

from __future__ import annotations

import json
import re
import time
import unicodedata
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
    "post-tool-use": ("PostToolUse", "agent_launch"),
}

#: Which lifecycle events each client has. Codex has no `Notification`, and its
#: agents are not named this way: the launch event reads Claude Code's Agent tool.
CLIENT_EVENTS: dict[str, frozenset[str]] = {
    "claude": frozenset(LIFECYCLE_EVENTS),
    "codex": frozenset(LIFECYCLE_EVENTS) - {"notification", "post-tool-use"},
}

#: The tool that starts an agent. `Task` is the name it had before Claude Code 2.1.63.
AGENT_TOOLS = frozenset({"Agent", "Task"})
AGENT_LAUNCH = "agent_launch"

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
    "label": 120,
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
    label: str | None = None


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


def agent_label(value: object) -> str | None:
    """One short line from the description of an Agent call, or nothing readable.

    A line break or a control separates words, so it becomes a space; a format
    mark (a bidirectional override, a zero-width joiner) and a lone surrogate
    SQLite could not encode separate nothing, so they go. A long description is
    cut and says so, unlike an id or a path: part of an id names something else,
    and part of a description is still most of what it said.
    """

    if not isinstance(value, str):
        return None
    kept: list[str] = []
    for ch in value:
        category = unicodedata.category(ch)
        if category in ("Cc", "Zl", "Zp"):
            kept.append(" ")
        elif category not in ("Cf", "Cs"):
            kept.append(ch)
    cleaned = " ".join("".join(kept).split())
    limit = LIMITS["label"]
    if len(cleaned) > limit:
        cleaned = cleaned[: limit - 1].rstrip() + "…"
    return cleaned or None


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
    if kind == AGENT_LAUNCH:
        launched = _launched_agent(payload)
        if launched is None:
            return None
        fields.update(launched)
    return HookEvent(
        event_uid=event_uid,
        occurred_at=occurred_at,
        client=client,
        hook_event=hook_event,
        kind=kind,
        session_id=session_id,
        **fields,
    )


def _launched_agent(payload: dict) -> dict[str, str | None] | None:
    """The agent an Agent call started, read from the one input that names both.

    `SubagentStart` has the agent's id and not the description, `PreToolUse` the
    description and no id yet. Only the answer has both, so nothing here matches
    one call to another and parallel launches cannot cross. The common
    `agent_id` and `agent_type` of this input are whoever made the call, and for
    a nested launch that is another agent.
    """

    if payload.get("tool_name") not in AGENT_TOOLS:
        return None
    answer = payload.get("tool_response")
    if not isinstance(answer, dict):
        return None
    agent_id = _text(answer.get("agentId"), "agent_id")
    if agent_id is None:
        return None
    arguments = payload.get("tool_input")
    if not isinstance(arguments, dict):
        arguments = {}
    return {
        "agent_id": agent_id,
        "agent_type": _text(arguments.get("subagent_type"), "agent_type"),
        "label": agent_label(arguments.get("description")),
    }


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

    version = line.get("v")
    if type(version) is not int or version != SPOOL_VERSION:
        return None
    if not set(line) <= _FIELDS | _SPOOL_ONLY:
        return None
    # Every value is text or absent before anything looks one up: a list or an
    # object from disk would otherwise reach a dictionary lookup and raise.
    if not all(
        value is None or isinstance(value, str) for key, value in line.items() if key != "v"
    ):
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
    for field in ("event_uid", "occurred_at", "client", "hook_event", "kind"):
        if not isinstance(getattr(record, field), str):
            return None
    for field, limit in LIMITS.items():
        value = getattr(record, field)
        if value is None and field != "session_id":
            continue
        if not isinstance(value, str) or not value or len(value) > limit:
            return None
    if record.label is not None and record.label != agent_label(record.label):
        return None
    if not _UID.fullmatch(record.event_uid) or not _TIMESTAMP.fullmatch(record.occurred_at):
        return None
    if record.client not in CLIENT_EVENTS or _KIND_OF_HOOK.get(record.hook_event) != record.kind:
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
