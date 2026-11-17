"""A stand-in for Claude Code and Codex in the probe runner's self-check.

It takes the command line the runner gives either client and does what the
client would do with the profile, without a model: it runs the registered
hooks, starts the registered MCP server, makes the calls its prompt lists and
writes its output in the client's own structured format, so the run records it
as it would a real one. The prompt is a JSON object:

    {"calls": [{"tool": "claim_work_item", "args": {...}}], "answer": "..."}

A prompt that is not JSON is answered as it stands, with no call.

Claude Code is told apart by `-p`, Codex by `exec`. When
`PROBE_FAKE_VALKAMA_HOOKS` names another registration in the same client's
format, its Valkama hooks run in place of the profile's: that is how the
self-check runs a session on the hooks a release built for another store schema
registers, and nothing else of the session changes.

Nothing of the `tests` package is imported: importing it would point
`VALKAMA_DB` and the store's guard elsewhere for every child started here.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import shlex
import subprocess
import sys
import tomllib
import uuid
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
OVERRIDE = "PROBE_FAKE_VALKAMA_HOOKS"
TOOL_PREFIX = "mcp__valkama__"
_SPEC = importlib.util.spec_from_file_location("agent_probes", HERE.parent / "agent_probes.py")
assert _SPEC is not None and _SPEC.loader is not None
probes: Any = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = probes
_SPEC.loader.exec_module(probes)


def emit(record: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(record, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def parse(argv: list[str]) -> tuple[str, str, str | None]:
    """The client, the prompt and the session to resume, from either client's command line."""

    if "-p" in argv:
        resume = argv[argv.index("--resume") + 1] if "--resume" in argv else None
        return "claude", argv[argv.index("-p") + 1], resume
    words = argv[argv.index("exec") + 1 :]
    positional = []
    index = 0
    while index < len(words):
        word = words[index]
        index += 2 if word in ("-C", "-s", "-c") else 1
        if not word.startswith("-"):
            positional.append(word)
    if positional[0] == "resume":
        return "codex", positional[2], positional[1]
    return "codex", positional[0], None


def registration(client: str) -> dict[str, Any]:
    if client == "claude":
        path = Path(os.environ["CLAUDE_CONFIG_DIR"]) / "settings.json"
    else:
        path = Path(os.environ["CODEX_HOME"]) / "hooks.json"
    hooks = json.loads(path.read_text(encoding="utf-8"))
    override = os.environ.get(OVERRIDE)
    if not override:
        return hooks
    replacement = json.loads(Path(override).read_text(encoding="utf-8"))
    merged: dict[str, list] = {}
    for event, group, hook in probes.hook_groups(hooks):
        if probes.valkama_hook(hook) is None:
            merged.setdefault(event, []).append({**group, "hooks": [hook]})
    for event, group, hook in probes.hook_groups(replacement):
        if probes.valkama_hook(hook) is not None:
            merged.setdefault(event, []).append({**group, "hooks": [hook]})
    return {"hooks": merged}


def matches(group: dict[str, Any], subject: str | None) -> bool:
    matcher = group.get("matcher")
    if subject is None or matcher in (None, "", "*"):
        return True
    # A pattern such as `^mcp__valkama__` matches the start of a tool's name.
    return re.search(matcher, subject) is not None


def run_hooks(
    client: str, hooks: dict[str, Any], event: str, payload: dict[str, Any], subject: str | None
) -> None:
    for name, group, hook in probes.hook_groups(hooks):
        if name != event or not matches(group, subject):
            continue
        if hook.get("type", "command") != "command" or hook.get("async") or hook.get("asyncRewake"):
            continue
        if "args" in hook:
            argv: list[str] | str = [hook["command"], *hook["args"]]
        elif sys.platform == "win32":
            argv = hook.get("commandWindows") or hook["command"]
        else:
            argv = shlex.split(hook["command"])
        done = subprocess.run(
            argv,
            input=json.dumps({**payload, "hook_event_name": event}).encode("utf-8"),
            capture_output=True,
            timeout=float(hook.get("timeout") or 60),
            check=False,
        )
        if client == "claude":
            emit(
                {
                    "type": "system",
                    "subtype": "hook_response",
                    "hook_event": event,
                    "stdout": done.stdout.decode("utf-8", errors="replace"),
                    "stderr": done.stderr.decode("utf-8", errors="replace"),
                    "exit_code": done.returncode,
                }
            )


def mcp_server(client: str) -> dict[str, Any]:
    if client == "claude":
        config = json.loads(
            (Path(os.environ["CLAUDE_CONFIG_DIR"]) / ".claude.json").read_text(encoding="utf-8")
        )
        return config["mcpServers"]["valkama"]
    config = tomllib.loads((Path(os.environ["CODEX_HOME"]) / "config.toml").read_text("utf-8"))
    return config["mcp_servers"]["valkama"]


def main(argv: list[str]) -> int:
    if argv == ["--version"]:
        sys.stdout.write("fake-client 1\n")
        return 0
    client, prompt, resume = parse(argv)
    session = resume or str(uuid.uuid4())
    hooks = registration(client)
    common = {"session_id": session, "cwd": os.getcwd(), "transcript_path": ""}
    if client == "claude":
        emit({"type": "system", "subtype": "init", "session_id": session})
    else:
        emit({"type": "thread.started", "thread_id": session})
    source = "resume" if resume else "startup"
    run_hooks(client, hooks, "SessionStart", {**common, "source": source}, source)
    run_hooks(client, hooks, "UserPromptSubmit", {**common, "prompt": prompt}, None)
    try:
        script = json.loads(prompt)
    except ValueError:
        script = {"calls": [], "answer": prompt}
    answer = script.get("answer", "Done.")
    server = mcp_server(client)
    mcp = None
    try:
        mcp = probes.McpClient(
            server["command"],
            server.get("args") or [],
            {**os.environ, **(server.get("env") or {})},
            cwd=Path.cwd(),
        )
        mcp.initialize(client)
    except probes.McpError as error:
        answer = f"Valkama is unavailable: {error}"
        script["calls"] = []
        if mcp is not None:
            mcp.close()
            mcp = None
    for call in script.get("calls") or ():
        call_id = f"call_{uuid.uuid4().hex}"
        if client == "claude":
            tool_name = TOOL_PREFIX + call["tool"]
            payload = {**common, "tool_name": tool_name, "tool_input": call["args"]}
            run_hooks(client, hooks, "PreToolUse", {**payload, "tool_use_id": call_id}, tool_name)
            meta = {"claudecode/toolUseId": call_id}
        else:
            meta = {"sessionId": session, "threadId": session, "callId": call_id}
        result, error = mcp.call(call["tool"], call["args"], meta)
        if client == "claude":
            use = {"type": "tool_use", "id": call_id, "name": tool_name, "input": call["args"]}
            emit({"type": "assistant", "message": {"content": [use]}})
            done = {"type": "tool_result", "tool_use_id": call_id, "content": json.dumps(result)}
            emit({"type": "user", "message": {"content": [{**done, "is_error": error}]}})
        else:
            item = {"type": "mcp_tool_call", "server": "valkama", "tool": call["tool"]}
            emit({"type": "item.completed", "item": {**item, "result": result, "error": error}})
    if mcp is not None:
        mcp.close()
    run_hooks(client, hooks, "Stop", common, None)
    if client == "claude":
        emit({"type": "result", "subtype": "success", "result": answer, "session_id": session})
    else:
        emit({"type": "item.completed", "item": {"type": "agent_message", "text": answer}})
        emit({"type": "turn.completed", "usage": {"input_tokens": 0, "output_tokens": 0}})
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
