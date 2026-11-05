"""From one transcript record to what the clock reads: a step, with no text in it.

Claude Code and Codex write different records, and the clock (`usage_clock`) reads only
these steps, so a client's format ends here. A step carries ids, times and counters.
The one exception is `packet`, a first message's text for the collector to read a number
from; it goes no further than that.

A Claude transcript, as measured:

- `timestamp` is when the record was written, UTC with milliseconds. A resume writes
  earlier records again under their old time and uuid, so time alone does not move
  forward. Record types without a `timestamp` (`last-prompt`, `mode`, `custom-title` and
  the like) are bookkeeping and say nothing about time.
- A file a session was forked into starts with records of the session it came from,
  each naming that session in `sessionId`. They belong to that session and are skipped.
  A subagent's records may name another session than its folder, and those are its own.
- `user` is a person's prompt, an input of another kind (`origin.kind`:
  `task-notification`, `peer`, `coordinator`), or the result of a tool call.
- `queue-operation` with `enqueue` says a notice arrived, which is when a background
  command ended, and the `user` record with its text may come later. Its `<tool-use-id>`
  or `<task-id>` says which command.
- `system` with `subtype: api_error` is a failed request about to be retried. Other
  subtypes (`stop_hook_summary`, `compact_boundary`) are bookkeeping inside a turn.
- `api-request*` and `attachment` records carry nothing the clock needs and take a third
  of the bytes, so `worth_parsing` skips them without parsing.

A Codex rollout: every record has `timestamp` and `payload`. `task_started` and
`task_complete` bound a turn, `token_usage_record` holds one response's usage under its
`response_id`, and an older rollout has only `token_count` events, repeated when nothing
changed. Input there includes the cache, so it is made non-overlapping here.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, field

from ..hooks.normalize import AGENT_TOOLS
from .journal_values import _journal_timestamp, _token_delta, claude_request, codex_cumulative
from .usage_prices import request_cost

#: What a step is.
PROMPT = "prompt"
NOTICE = "notice"
PEER = "peer"
REPLY = "reply"
RESULT = "result"
FAILURE = "failure"
NOTIFIED = "notified"
SERVICE = "service"

#: What a tool call waits for: a script, a person, or a subagent.
SCRIPT = "script"
ASKING = "asking"
AGENT = "agent"

_ASKING_TOOLS = frozenset({"AskUserQuestion", "ExitPlanMode", "request_user_input"})
_AGENT_TOOLS = AGENT_TOOLS | {"wait_agent"}
_ENDS_TURN = frozenset({"end_turn", "stop_sequence", "max_tokens", "refusal"})
#: A Codex turn started by a person, typed now or queued before.
_PERSON_TRIGGERS = frozenset({None, "composer", "queue", "resume_interrupted_task"})
_TOOL_USE_ID = re.compile(r"<tool-use-id>([^<]{1,128})</tool-use-id>")
_TASK_ID = re.compile(r"<task-id>([^<]{1,128})</task-id>")
_NOTICE = "<task-notification"
#: How far into a record its `attachment` key can sit, past its two ids.
_ATTACHMENT_HEAD = 160


@dataclass(slots=True)
class Part:
    """What one model did for one request."""

    model: str
    tokens: dict[str, int]
    cost: float | None
    #: A sub-inference on the side, which does not change the agent's own model.
    advisor: bool = False


@dataclass(slots=True)
class Step:
    """One record, as the clock reads it."""

    at: float
    kind: str
    request: str | None = None
    parts: list[Part] = field(default_factory=list)
    #: Tool calls this record opens: id and what each waits for.
    calls: dict[str, str] = field(default_factory=dict)
    ends_turn: bool = False
    synthetic: bool = False
    #: Tool calls this record answers.
    closed: tuple[str, ...] = ()
    #: A call answered at once that goes on in the background: its id, and the kind and
    #: task id the notice will name.
    background: dict[str, dict[str, object]] = field(default_factory=dict)
    #: Subagents a finished call ran, for the question whether they keep a transcript.
    agents: tuple[str, ...] = ()
    #: The ids a notice names, and whether it is the last one about them.
    links: tuple[str, ...] = ()
    final: bool = False
    packet: str | None = None


def worth_parsing(line: bytes) -> bool:
    """False for a record the clock never reads, told without parsing it.

    Inside a JSON string a quote is escaped, so `"attachment":{` this early can only be
    the record's own key.
    """

    return not (
        line.startswith(b'{"type":"api-request') or b'"attachment":{' in line[:_ATTACHMENT_HEAD]
    )


def _number(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _put(tokens: dict[str, int], kind: str, value: object) -> None:
    number = _number(value)
    if number is not None:
        tokens[kind] = number


def _claude_tokens(usage: Mapping[str, object]) -> dict[str, int]:
    """One usage object as non-overlapping kinds. A counter it lacks stays absent."""

    tokens: dict[str, int] = {}
    _put(tokens, "input", usage.get("input_tokens"))
    _put(tokens, "cached_read", usage.get("cache_read_input_tokens"))
    split = usage.get("cache_creation")
    if isinstance(split, Mapping):
        _put(tokens, "cache_write_5m", split.get("ephemeral_5m_input_tokens"))
        _put(tokens, "cache_write_1h", split.get("ephemeral_1h_input_tokens"))
    else:
        _put(tokens, "cache_write_5m", usage.get("cache_creation_input_tokens"))
    _put(tokens, "output", usage.get("output_tokens"))
    details = usage.get("output_tokens_details")
    if isinstance(details, Mapping):
        _put(tokens, "reasoning", details.get("thinking_tokens"))
    return tokens


def _claude_parts(model: str, usage: Mapping[str, object]) -> list[Part]:
    """The executor's usage and each advisor call's, which the top level leaves out.

    A request that ran several iterations is priced per iteration, since its prompt
    length is what a price tier reads.
    """

    geo = usage.get("inference_geo")
    speed = usage.get("speed")
    geo_name = geo if isinstance(geo, str) else None
    speed_name = speed if isinstance(speed, str) else None
    server_tools = usage.get("server_tool_use")
    searches = (
        _number(server_tools.get("web_search_requests"))
        if isinstance(server_tools, Mapping)
        else None
    )
    tokens = _claude_tokens(usage)
    listed = usage.get("iterations")
    iterations = (
        [item for item in listed if isinstance(item, Mapping)] if isinstance(listed, list) else []
    )
    own = [item for item in iterations if item.get("type") == "message"]
    cost: float | None
    if len(own) > 1:
        costs = [
            request_cost(model, _claude_tokens(item), geo=geo_name, speed=speed_name)
            for item in own
        ]
        cost = None if None in costs else sum(value for value in costs if value is not None)
        if cost is not None:
            cost += (searches or 0) * 0.01
    else:
        cost = request_cost(model, tokens, geo=geo_name, speed=speed_name, searches=searches or 0)
    parts = [Part(model, tokens, cost)]
    for item in iterations:
        if item.get("type") == "advisor_message":
            adviser = str(item.get("model") or "")
            spent = _claude_tokens(item)
            parts.append(Part(adviser, spent, request_cost(adviser, spent, geo=geo_name), True))
    return parts


def _links(text: str) -> tuple[str, ...]:
    found = [pattern.search(text) for pattern in (_TOOL_USE_ID, _TASK_ID)]
    return tuple(match.group(1) for match in found if match is not None)


def _claude_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                return str(block.get("text") or "")
    return ""


def _claude_result(at: float, row: Mapping[str, object], content: list) -> Step:
    closed = tuple(
        str(block.get("tool_use_id"))
        for block in content
        if isinstance(block, dict) and block.get("type") == "tool_result"
    )
    step = Step(at, RESULT, closed=closed)
    result = row.get("toolUseResult")
    if isinstance(result, Mapping) and closed:
        task = result.get("backgroundTaskId") or (
            result.get("taskId") if "timeoutMs" in result else None
        )
        if task:
            step.background[closed[0]] = {"kind": SCRIPT, "task": str(task)}
        elif result.get("agentId"):
            if result.get("isAsync"):
                step.background[closed[0]] = {"kind": AGENT, "task": str(result["agentId"])}
            else:
                step.agents = (str(result["agentId"]),)
    return step


def _claude_user(at: float, row: Mapping[str, object], content: object) -> Step:
    if isinstance(content, list) and any(
        isinstance(block, dict) and block.get("type") == "tool_result" for block in content
    ):
        return _claude_result(at, row, content)
    text = _claude_text(content)
    origin = row.get("origin")
    kind = origin.get("kind") if isinstance(origin, Mapping) else None
    if row.get("isCompactSummary"):
        return Step(at, SERVICE)
    if kind == "task-notification" or text.startswith(_NOTICE):
        return Step(at, NOTICE, links=_links(text), final="<status>" in text)
    if kind == "human":
        return Step(at, PROMPT, packet=text)
    if kind is None:
        return Step(at, SERVICE if row.get("isMeta") else PROMPT, packet=text)
    return Step(at, PEER, packet=text)


def claude_step(row: Mapping[str, object], own_session: str | None) -> Step | None:
    """One Claude record as a step, or None when the clock has no use for it.

    `own_session` is the session a session's own transcript belongs to, and None for a
    subagent's, whose records may name another.
    """

    if own_session is not None and row.get("sessionId", own_session) != own_session:
        return None
    kind = row.get("type")
    if kind not in ("user", "assistant", "system", "queue-operation"):
        return None
    stamp = _journal_timestamp(row)
    if stamp is None:
        return None
    at = stamp.timestamp()
    if kind == "queue-operation":
        content = row.get("content")
        if row.get("operation") != "enqueue" or not isinstance(content, str):
            return None
        if not content.startswith(_NOTICE):
            return None
        return Step(at, NOTIFIED, links=_links(content), final="<status>" in content)
    if kind == "system":
        return Step(at, FAILURE if row.get("subtype") == "api_error" else SERVICE)
    if kind == "user":
        message = row.get("message")
        return _claude_user(
            at, row, message.get("content") if isinstance(message, Mapping) else None
        )
    message = claude_request(row)
    if message is None:
        return None
    usage = message.get("usage")
    model = str(message.get("model") or "")
    synthetic = bool(row.get("isApiErrorMessage")) or model == "<synthetic>"
    content = message.get("content")
    calls = {}
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "tool_use":
                calls[str(block.get("id"))] = _tool_kind(str(block.get("name")))
    return Step(
        at,
        REPLY,
        request=str(message["id"]),
        parts=_claude_parts(model, usage) if isinstance(usage, Mapping) and not synthetic else [],
        calls=calls,
        ends_turn=message.get("stop_reason") in _ENDS_TURN and not calls,
        synthetic=synthetic,
    )


def _tool_kind(name: str) -> str:
    if name in _ASKING_TOOLS:
        return ASKING
    return AGENT if name in _AGENT_TOOLS else SCRIPT


def _codex_part(usage: Mapping[str, object], memo: Mapping[str, object]) -> Part:
    """One response's usage, with the cache taken out of its input."""

    model = str(memo.get("model") or "")
    tokens: dict[str, int] = {}
    cached = _number(usage.get("cached_input_tokens"))
    written = _number(usage.get("cache_write_input_tokens"))
    raw = _number(usage.get("input_tokens"))
    if raw is not None:
        tokens["input"] = max(0, raw - (cached or 0) - (written or 0))
    _put(tokens, "cached_read", cached)
    _put(tokens, "cache_write_5m", written)
    _put(tokens, "output", usage.get("output_tokens"))
    _put(tokens, "reasoning", usage.get("reasoning_output_tokens"))
    speed = memo.get("speed")
    return Part(
        model, tokens, request_cost(model, tokens, speed=speed if isinstance(speed, str) else None)
    )


def _codex_event(at: float, payload: Mapping[str, object], memo: dict) -> Step | None:
    kind = payload.get("type")
    if kind == "task_started":
        attribution = payload.get("turn_attribution")
        trigger = attribution.get("turn_trigger") if isinstance(attribution, Mapping) else None
        return Step(at, PROMPT if trigger in _PERSON_TRIGGERS else PEER)
    if kind in ("task_complete", "turn_aborted"):
        return Step(at, REPLY, ends_turn=True)
    if kind == "thread_settings_applied":
        settings = payload.get("thread_settings")
        if isinstance(settings, Mapping):
            memo["speed"] = settings.get("service_tier")
            memo["model"] = settings.get("model") or memo.get("model")
        return None
    cumulative = codex_cumulative(payload)
    if cumulative is None or memo.get("records"):
        return None
    previous = memo.get("cumulative")
    if cumulative == previous:
        return None
    memo["cumulative"] = dict(cumulative)
    info = payload.get("info")
    last = info.get("last_token_usage") if isinstance(info, Mapping) else None
    if not isinstance(last, Mapping):
        last, _reason = _token_delta(cumulative, previous or dict.fromkeys(cumulative, 0))
    return Step(at, REPLY, parts=[_codex_part(last, memo)]) if last else None


def codex_step(row: Mapping[str, object], memo: dict) -> Step | None:
    """One Codex record as a step. `memo` holds what later records need of earlier ones."""

    kind = row.get("type")
    payload = row.get("payload")
    if not isinstance(payload, Mapping):
        return None
    stamp = _journal_timestamp(row)
    if stamp is None:
        return None
    at = stamp.timestamp()
    if kind == "turn_context":
        memo["model"] = payload.get("model") or memo.get("model")
        return None
    if kind == "event_msg":
        return _codex_event(at, payload, memo)
    if kind == "token_usage_record":
        memo["records"] = True
        usage = payload.get("usage")
        if not isinstance(usage, Mapping):
            return None
        request = payload.get("response_id")
        return Step(
            at,
            REPLY,
            request=str(request) if request else None,
            parts=[_codex_part(usage, memo)],
        )
    if kind != "response_item":
        return None
    item = payload.get("type")
    if item in ("function_call", "custom_tool_call"):
        return Step(
            at, REPLY, calls={str(payload.get("call_id")): _tool_kind(str(payload.get("name")))}
        )
    if item in ("function_call_output", "custom_tool_call_output"):
        return Step(at, RESULT, closed=(str(payload.get("call_id")),))
    if item == "message" and payload.get("role") == "user":
        return Step(at, SERVICE, packet=_codex_text(payload.get("content")))
    if item in ("message", "reasoning", "agent_message"):
        return Step(at, REPLY)
    return None


def _codex_text(content: object) -> str:
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and isinstance(block.get("text"), str):
                return block["text"]
    return ""
