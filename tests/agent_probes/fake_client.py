"""A stand-in for Claude Code and Codex in the probe runner's self-check.

It takes the command line the runner gives either client and does what the
client would do with the profile, without a model: it runs the registered
hooks, starts the registered MCP server, makes the calls its prompt lists and
writes its output in the client's own structured format, so the run records it
as it would a real one. The prompt is a JSON object:

    {"skill": true, "calls": [{"tool": "claim_work_item", "args": {...}}],
     "files": {"app/NOTES.md": "text"}, "subagent": {"calls": [...], "report": "..."},
     "subagents": [{"calls": [...], "report": "...", "background": true}], "answer": "..."}

Every key is optional. `skill` loads the Valkama skill first, as each client
does: Claude Code by its Skill tool, Codex by reading the skill's file in a
shell. `files` are written as each client's edit, `subagent` runs its calls as
one subagent and returns its report, and `subagents` runs several. One with
`background` runs as Claude Code's backgrounded agent does: its launch answers
with where it runs, and its report comes in the notification of its end; Codex
has no such mode and runs it as any other. A prompt that is not JSON is answered as it
stands, with no call. The output has the shapes the real clients write: the
`stream-json` lines of Claude Code and the `--json` items of Codex, with each
turn's tokens.

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
    if script.get("skill") and mcp is not None:
        load_skill(client)
    turn = Turn(client, hooks, common, mcp)
    for call in script.get("calls") or () if mcp is not None else ():
        turn.call(call)
    for name, text in (script.get("files") or {}).items():
        turn.write(Path.cwd() / name, text)
    works = list(script.get("subagents") or ())
    if script.get("subagent"):
        works.insert(0, script["subagent"])
    for work in works if mcp is not None else ():
        turn.subagent(work)
    if mcp is not None:
        mcp.close()
    run_hooks(client, hooks, "Stop", common, None)
    if client == "claude":
        emit(
            {
                "type": "result",
                "subtype": "success",
                "result": answer,
                "session_id": session,
                "usage": CLAUDE_USAGE,
            }
        )
    else:
        emit({"type": "item.completed", "item": {"type": "agent_message", "text": answer}})
        emit({"type": "turn.completed", "usage": CODEX_USAGE})
    return 0


#: The tokens each turn reports, in each client's own words.
CLAUDE_USAGE = {
    "input_tokens": 3,
    "cache_creation_input_tokens": 100,
    "cache_read_input_tokens": 1000,
    "output_tokens": 50,
    "output_tokens_details": {"thinking_tokens": 20},
}
CODEX_USAGE = {
    "input_tokens": 1200,
    "cached_input_tokens": 1000,
    "cache_write_input_tokens": 0,
    "output_tokens": 60,
    "reasoning_output_tokens": 10,
}


def load_skill(client: str) -> None:
    if client == "claude":
        use = {"type": "tool_use", "id": f"toolu_{uuid.uuid4().hex}", "name": "Skill"}
        emit(
            {"type": "assistant", "message": {"content": [{**use, "input": {"skill": "valkama"}}]}}
        )
        return
    path = Path(os.environ["HOME"]) / ".agents" / "skills" / "valkama" / "SKILL.md"
    item = {
        "id": f"item_{uuid.uuid4().hex}",
        "type": "command_execution",
        "command": f"pwsh -Command \"Get-Content -LiteralPath '{path.as_posix()}'\"",
        "aggregated_output": path.read_text(encoding="utf-8") if path.is_file() else "",
        "exit_code": 0,
        "status": "completed",
    }
    emit({"type": "item.completed", "item": item})


class Turn:
    """The calls of one turn, made as the client makes them and written as it writes them."""

    def __init__(
        self, client: str, hooks: dict[str, Any], common: dict[str, Any], mcp: Any
    ) -> None:
        self.client, self.hooks, self.common, self.mcp = client, hooks, common, mcp
        self.session = str(common["session_id"])

    def call(
        self, call: dict[str, Any], *, parent: str | None = None, thread: str | None = None
    ) -> None:
        call_id = f"call_{uuid.uuid4().hex}"
        tool_name = TOOL_PREFIX + call["tool"]
        if self.client == "claude":
            payload = {**self.common, "tool_name": tool_name, "tool_input": call["args"]}
            if parent is not None:
                payload["agent_id"] = parent
            hook = {**payload, "tool_use_id": call_id}
            run_hooks(self.client, self.hooks, "PreToolUse", hook, tool_name)
            meta: dict[str, Any] = {"claudecode/toolUseId": call_id}
        else:
            session = thread or self.session
            meta = {"sessionId": session, "threadId": session, "callId": call_id}
        result, error = self.mcp.call(call["tool"], call["args"], meta)
        text = json.dumps(result)
        if self.client == "claude":
            use = {"type": "tool_use", "id": call_id, "name": tool_name, "input": call["args"]}
            emit({"type": "assistant", "message": {"content": [use]}, "parent_tool_use_id": parent})
            done = {"type": "tool_result", "tool_use_id": call_id, "content": text}
            emit(
                {
                    "type": "user",
                    "message": {"content": [{**done, "is_error": error}]},
                    "parent_tool_use_id": parent,
                }
            )
        elif thread is None:
            # A Codex subagent's calls are its own thread's, which the parent's output
            # does not carry.
            item = {
                "id": f"item_{uuid.uuid4().hex}",
                "type": "mcp_tool_call",
                "server": "valkama",
                "tool": call["tool"],
                "arguments": call["args"],
                "result": {"content": [{"type": "text", "text": text}]},
                "error": {"message": text} if error else None,
                "status": "failed" if error else "completed",
            }
            emit({"type": "item.completed", "item": item})

    def write(self, path: Path, text: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        if self.client == "claude":
            use = {
                "type": "tool_use",
                "id": f"toolu_{uuid.uuid4().hex}",
                "name": "Write",
                "input": {"file_path": str(path), "content": text},
            }
            emit({"type": "assistant", "message": {"content": [use]}, "parent_tool_use_id": None})
            return
        changes = [{"path": str(path), "kind": "add"}]
        item = {"id": f"item_{uuid.uuid4().hex}", "type": "file_change", "changes": changes}
        emit({"type": "item.completed", "item": {**item, "status": "completed"}})

    def subagent(self, work: dict[str, Any]) -> None:
        report = str(work.get("report") or "Done.")
        if self.client == "claude":
            launch = f"toolu_{uuid.uuid4().hex}"
            use = {
                "type": "tool_use",
                "id": launch,
                "name": "Task",
                "input": {"description": "a part of the work", "prompt": "Do the part."},
            }
            emit({"type": "assistant", "message": {"content": [use]}, "parent_tool_use_id": None})
            background = bool(work.get("background"))
            if background:
                started = {"type": "system", "subtype": "task_started", "tool_use_id": launch}
                emit({**started, "is_backgrounded": True})
                launched = (
                    "Async agent launched successfully.\nThe agent is working in the background."
                )
                done = {"type": "tool_result", "tool_use_id": launch, "content": launched}
                emit({"type": "user", "message": {"content": [done]}, "parent_tool_use_id": None})
            for call in work.get("calls") or ():
                self.call(call, parent=launch)
            if background:
                end = {"type": "system", "subtype": "task_notification", "tool_use_id": launch}
                emit({**end, "status": "completed", "handback_report": {"text": report}})
                return
            done = {"type": "tool_result", "tool_use_id": launch, "content": report}
            emit({"type": "user", "message": {"content": [done]}, "parent_tool_use_id": None})
            return
        thread = str(uuid.uuid4())
        start = {**self.common, "session_id": thread, "source": "startup"}
        run_hooks(self.client, self.hooks, "SessionStart", start, "startup")
        spawn = {
            "id": f"item_{uuid.uuid4().hex}",
            "type": "collab_tool_call",
            "tool": "spawn_agent",
            "sender_thread_id": self.session,
            "receiver_thread_ids": [thread],
            "prompt": "Do the part.",
            "agents_states": {thread: {"status": "running", "message": None}},
            "status": "completed",
        }
        emit({"type": "item.completed", "item": spawn})
        for call in work.get("calls") or ():
            self.call(call, thread=thread)
        waited = {
            **spawn,
            "id": f"item_{uuid.uuid4().hex}",
            "tool": "wait",
            "agents_states": {thread: {"status": "completed", "message": report}},
        }
        emit({"type": "item.completed", "item": waited})


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
