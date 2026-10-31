"""A stand-in for one pinned release, for the stdio front's tests.

`tests/test_mcp_front.py` copies this file into a release directory as
`valkama.py`, next to a `fake.json` that says how this release behaves. It
answers `capabilities` and serves just enough MCP over stdio to be told apart
from another release, and it logs what happened to it, one JSON line per
event, so a test can read the order in which releases started, answered and
exited.

It is a test double, not a server: nothing here is the contract.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

CONFIG = json.loads(Path(__file__).with_name("fake.json").read_text(encoding="utf-8"))
NAME = CONFIG["name"]


def log(event: str, **detail: object) -> None:
    record = {"event": event, "release": NAME, "pid": os.getpid(), **detail}
    with open(CONFIG["log"], "a", encoding="utf-8") as handle:
        handle.write(json.dumps(record) + "\n")


def write(message: dict) -> None:
    if CONFIG.get("junk"):
        sys.stdout.buffer.write(b"not a protocol frame\n")
        sys.stderr.buffer.write(b"noise on stderr\n")
        sys.stderr.buffer.flush()
    sys.stdout.buffer.write((json.dumps(message, ensure_ascii=False) + "\n").encode("utf-8"))
    sys.stdout.buffer.flush()


def open_store() -> None:
    """Refuse a store newer than this release, and migrate an older one."""

    store = CONFIG.get("store")
    if not store:
        return
    schema = int(CONFIG.get("schema", 1))
    stored = json.loads(Path(store).read_text(encoding="utf-8"))["schema"]
    if stored > schema:
        log("refused", stored=stored)
        sys.stderr.write(f"store is at schema {stored} and this build understands {schema}\n")
        raise SystemExit(1)
    if stored < schema:
        Path(store).write_text(json.dumps({"schema": schema}), encoding="utf-8")
        log("migrated", schema=schema)


def tools() -> list[dict]:
    return [
        {"name": name, "description": f"the {name} tool", "inputSchema": {"type": "object"}}
        for name in CONFIG.get("tools", ["ping_tool"])
    ]


def call(raw: bytes, arguments: dict) -> dict | None:
    log("call-start")
    if arguments.get("exit"):
        log("exit-mid-call")
        raise SystemExit(4)
    gate = arguments.get("wait_for")
    deadline = time.monotonic() + 30
    while gate and not Path(gate).exists() and time.monotonic() < deadline:
        time.sleep(0.02)
    log("call-end")
    text = json.dumps({"release": NAME, "pid": os.getpid(), "raw": raw.decode("utf-8")})
    return {"content": [{"type": "text", "text": text}], "isError": False}


def answer(raw: bytes, message: dict) -> dict | None:
    method = message.get("method")
    params = message.get("params") if isinstance(message.get("params"), dict) else {}
    if method == "server/discover":
        return {
            "resultType": "complete",
            "supportedVersions": ["2026-07-28"],
            "capabilities": {"tools": {}},
            "instructions": f"release {NAME}",
        }
    if method == "initialize":
        log("initialize", params=params)
        return {
            "protocolVersion": params.get("protocolVersion"),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": NAME, "version": "0"},
        }
    if method == "tools/list":
        return {"tools": tools()}
    if method == "tools/call":
        return call(raw, params.get("arguments") or {})
    if method == "ping":
        return {}
    return None


def serve() -> None:
    log("start")
    open_store()
    if CONFIG.get("exit_on_start"):
        log("crashed")
        sys.stderr.write(f"release {NAME} refused to start\n")
        raise SystemExit(3)
    if CONFIG.get("child"):
        child = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(30)"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        log("child", child=child.pid)
    for raw in sys.stdin.buffer:
        message = json.loads(raw)
        if message.get("method") == "notifications/initialized":
            log("initialized")
        if "method" not in message or message.get("id") is None:
            continue
        result = answer(raw, message)
        if result is None:
            error = {"code": -32601, "message": f"method not supported: {message['method']}"}
            write({"jsonrpc": "2.0", "id": message["id"], "error": error})
        else:
            write({"jsonrpc": "2.0", "id": message["id"], "result": result})
    if CONFIG.get("ignore_eof"):
        log("ignoring-eof")
        time.sleep(30)
    log("exit")


if __name__ == "__main__":
    if sys.argv[1:] == ["capabilities"]:
        log("capabilities")
        code = int(CONFIG.get("capabilities_exit", 0))
        if code:
            sys.stderr.write(f"release {NAME} cannot import its surfaces\n")
        raise SystemExit(code)
    serve()
