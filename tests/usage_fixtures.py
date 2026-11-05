"""Made-up transcripts for the usage tests: every id, time and count here is invented.

`ClaudeRun` and `CodexRun` write records as those clients write them, in the shapes
measured on real files, so a test reads as what happened: a prompt, a reply, a script.
A time is seconds after `START`, and the same `Case` drives the collector over them with
ticks of the test's choosing.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sqlite3
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest import mock

from server import store
from server.hooks import ingest
from server.planning import calls
from server.planning import service as planning
from server.telemetry import liveness, usage_collect

START = dt.datetime(2030, 3, 4, 9, 0, 0, tzinfo=dt.UTC)
SPACE = "MAIN"
HOUR = 3600
MINUTE = 60


def stamp(seconds: float) -> str:
    moment = START + dt.timedelta(seconds=seconds)
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def epoch(seconds: float) -> float:
    return (START + dt.timedelta(seconds=seconds)).timestamp()


def usage(
    *,
    input_tokens: int = 10,
    read: int = 100,
    write_5m: int = 20,
    write_1h: int = 0,
    output: int = 5,
    **more: object,
) -> dict:
    return {
        "input_tokens": input_tokens,
        "cache_read_input_tokens": read,
        "cache_creation_input_tokens": write_5m + write_1h,
        "cache_creation": {
            "ephemeral_5m_input_tokens": write_5m,
            "ephemeral_1h_input_tokens": write_1h,
        },
        "output_tokens": output,
        "service_tier": "standard",
        "inference_geo": "global",
        **more,
    }


class ClaudeRun:
    """One transcript being written, a session's or a subagent's."""

    def __init__(self, path: Path, session: str, agent: str = "") -> None:
        self.path = path
        self.session = session
        self.agent = agent
        path.parent.mkdir(parents=True, exist_ok=True)
        self.model = "claude-opus-5-5"
        self._requests = 0

    def _write(self, row: dict) -> None:
        with self.path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(row) + "\n")

    def raw(self, text: str) -> None:
        with self.path.open("a", encoding="utf-8", newline="") as handle:
            handle.write(text)

    def _base(self, at: float, kind: str) -> dict:
        row = {
            "type": kind,
            "timestamp": stamp(at),
            "uuid": str(uuid.uuid4()),
            "sessionId": self.session,
            "parentUuid": None,
            "isSidechain": bool(self.agent),
        }
        if self.agent:
            row["agentId"] = self.agent
        return row

    def prompt(
        self, at: float, text: str = "do it", origin: str | None = "human", **more: object
    ) -> None:
        row = self._base(at, "user")
        row["message"] = {"role": "user", "content": text}
        if origin is not None:
            row["origin"] = {"kind": origin}
        self._write({**row, **more})

    def reply(
        self,
        at: float,
        *,
        tools: tuple[tuple[str, str], ...] = (),
        stop: str | None = None,
        request: str | None = None,
        model: str | None = None,
        spent: dict | None = None,
        background: bool = False,
        **more: object,
    ) -> str:
        """An assistant record; `tools` are (id, name). A new request unless one is named."""

        if request is None:
            self._requests += 1
            request = f"msg_{self.agent}_{self._requests}"
        content = [
            {
                "type": "tool_use",
                "id": ident,
                "name": name,
                "input": {"run_in_background": background} if background else {},
            }
            for ident, name in tools
        ] or [{"type": "text", "text": "done"}]
        row = self._base(at, "assistant")
        row["message"] = {
            "id": request,
            "role": "assistant",
            "model": model or self.model,
            "content": content,
            "stop_reason": stop or ("tool_use" if tools else None),
            "usage": spent if spent is not None else usage(),
        }
        self._write({**row, **more})
        return request

    def end_turn(self, at: float, **options: object) -> str:
        return self.reply(at, stop="end_turn", **options)

    def result(self, at: float, ident: str, **result: object) -> None:
        row = self._base(at, "user")
        row["message"] = {
            "role": "user",
            "content": [{"type": "tool_result", "tool_use_id": ident, "content": "ok"}],
        }
        if result:
            row["toolUseResult"] = result
        self._write(row)

    def background_result(self, at: float, ident: str, task: str) -> None:
        self.result(at, ident, backgroundTaskId=task, stdout="", stderr="")

    def agent_launched(self, at: float, ident: str, agent: str) -> None:
        self.result(at, ident, status="async_launched", agentId=agent, isAsync=True)

    def enqueue(
        self, at: float, *, tool: str = "", task: str = "", status: str | None = "completed"
    ) -> None:
        text = "<task-notification>"
        if task:
            text += f"<task-id>{task}</task-id>"
        if tool:
            text += f"<tool-use-id>{tool}</tool-use-id>"
        if status:
            text += f"<status>{status}</status>"
        text += "<summary>finished</summary></task-notification>"
        self._write(
            {
                "type": "queue-operation",
                "operation": "enqueue",
                "timestamp": stamp(at),
                "sessionId": self.session,
                "content": text,
            }
        )

    def notice(
        self, at: float, *, tool: str = "", task: str = "", status: str | None = "completed"
    ) -> None:
        text = "<task-notification>"
        if task:
            text += f"<task-id>{task}</task-id>"
        if tool:
            text += f"<tool-use-id>{tool}</tool-use-id>"
        if status:
            text += f"<status>{status}</status>"
        text += "</task-notification>"
        self.prompt(at, text, origin="task-notification")

    def system(self, at: float, subtype: str) -> None:
        row = self._base(at, "system")
        row["subtype"] = subtype
        self._write(row)

    def bookkeeping(self) -> None:
        """Records with no time, which say nothing about it."""

        self._write({"type": "last-prompt", "sessionId": self.session, "lastPrompt": "secret text"})
        self._write({"type": "mode", "sessionId": self.session, "mode": "default"})
        self._write({"type": "api-request-blob", "sessionId": self.session, "message": "x" * 200})
        self._write(
            {
                "parentUuid": None,
                "isSidechain": False,
                "attachment": {"type": "hook_success", "hookName": "Stop"},
                "type": "attachment",
                "timestamp": stamp(10**7),
                "uuid": str(uuid.uuid4()),
                "sessionId": self.session,
            }
        )


class CodexRun:
    """One rollout being written."""

    def __init__(self, path: Path, thread: str, parent: str = "") -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        meta: dict[str, object] = {
            "id": thread,
            "session_id": parent or thread,
            "timestamp": stamp(0),
        }
        if parent:
            meta["parent_thread_id"] = parent
        self._row(0, "session_meta", meta)
        self._responses = 0

    def _row(self, at: float, kind: str, payload: dict) -> None:
        row = {"timestamp": stamp(at), "ordinal": 0, "type": kind, "payload": payload}
        with self.path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(row) + "\n")

    def settings(self, at: float, model: str = "gpt-6.1-sol", tier: str = "default") -> None:
        self._row(at, "turn_context", {"model": model, "turn_id": "t"})
        self._row(
            at,
            "event_msg",
            {
                "type": "thread_settings_applied",
                "thread_settings": {"model": model, "service_tier": tier},
            },
        )

    def started(self, at: float, trigger: str = "composer") -> None:
        self._row(
            at,
            "event_msg",
            {"type": "task_started", "turn_attribution": {"turn_trigger": trigger}},
        )

    def complete(self, at: float) -> None:
        self._row(at, "event_msg", {"type": "task_complete", "duration_ms": 1})

    def call(self, at: float, ident: str, name: str = "exec") -> None:
        self._row(at, "response_item", {"type": "custom_tool_call", "call_id": ident, "name": name})

    def output(self, at: float, ident: str) -> None:
        self._row(at, "response_item", {"type": "custom_tool_call_output", "call_id": ident})

    def message(self, at: float, role: str = "assistant", text: str = "") -> None:
        self._row(
            at,
            "response_item",
            {"type": "message", "role": role, "content": [{"type": "input_text", "text": text}]},
        )

    def usage_record(
        self, at: float, *, input_tokens: int, cached: int, output: int, reasoning: int = 0
    ) -> None:
        self._responses += 1
        self._row(
            at,
            "token_usage_record",
            {
                "response_id": f"resp_{self._responses}",
                "usage": {
                    "input_tokens": input_tokens,
                    "cached_input_tokens": cached,
                    "cache_write_input_tokens": 0,
                    "output_tokens": output,
                    "reasoning_output_tokens": reasoning,
                    "total_tokens": input_tokens + output,
                },
            },
        )

    def token_count(self, at: float, cumulative: dict, last: dict | None = None) -> None:
        self._row(
            at,
            "event_msg",
            {
                "type": "token_count",
                "info": {"total_token_usage": cumulative, "last_token_usage": last},
            },
        )


class Case(unittest.TestCase):
    """A store of its own, its transcripts in a folder of their own, and one collector."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.store_path = str(self.root / "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.store_path})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        planning.create_planning_space(self.conn, project_id="work", name="Work", key=SPACE)
        self.conn.commit()
        self.reader = ingest.open_light(self.store_path, store.STORE_SCHEMA_VERSION)
        self.addCleanup(self.reader.close)
        self.reader.execute("PRAGMA busy_timeout = 5000")
        self.collector = usage_collect.Collector(self.reader, self.store_path)
        self.said: list[str] = []

    def item(self, title: str = "Work", **fields: object) -> tuple[str, str]:
        created = planning.create_work_item(self.conn, space=SPACE, title=title, **fields)
        self.conn.commit()
        return str(created["reference"]), str(created["work_item_id"])

    def session(
        self, session: str = "sess-1", client: str = "claude", path: Path | None = None
    ) -> ClaudeRun:
        transcript = path or self.root / "projects" / f"{session}.jsonl"
        self.conn.execute(
            "INSERT INTO sessions(id, client, transcript_path, status, started_at, last_seen)"
            " VALUES (?, ?, ?, 'active', ?, ?)",
            (session, client, str(transcript), stamp(0), stamp(0)),
        )
        self.conn.commit()
        return ClaudeRun(transcript, session)

    def subagent(self, session: str, agent: str, label: str = "") -> ClaudeRun:
        parent = self.root / "projects" / f"{session}.jsonl"
        path = parent.parent / session / "subagents" / f"agent-{agent}.jsonl"
        self.conn.execute(
            "INSERT INTO sessions(id, client, parent_session_id, agent_id, label, status, started_at,"
            " last_seen) VALUES (?, 'claude', ?, ?, ?, 'active', ?, ?)",
            (f"{session}/{agent}", session, agent, label, stamp(0), stamp(0)),
        )
        self.conn.commit()
        return ClaudeRun(path, session, agent)

    def write(self, session: str, reference: str, at: float, agent: str | None = None) -> None:
        """A confirmed write call that names `reference`, at that moment."""

        identity = calls.Identity(
            state=calls.CONFIRMED,
            source=calls.CLAUDE_HOOK,
            session_id=session,
            agent_id=agent,
            client="claude",
        )
        with calls.bind(identity, "comment_work_item"):
            planning.comment_work_item(self.conn, reference, "a note")
        self.conn.commit()
        self.conn.execute("DROP TRIGGER IF EXISTS execution_events_append_only_update")
        self.conn.execute(
            "UPDATE execution_events SET received_at = ? WHERE id ="
            " (SELECT MAX(id) FROM execution_events)",
            (stamp(at),),
        )
        self.conn.commit()

    def claim(self, session: str, reference: str, at: float) -> None:
        identity = calls.Identity(
            state=calls.CONFIRMED,
            source=calls.CLAUDE_HOOK,
            session_id=session,
            client="claude",
        )
        with calls.bind(identity, "claim_work_item"):
            planning.claim_work_item(self.conn, reference, move_state=False)
        self.conn.commit()
        self.conn.execute(
            "UPDATE work_item_events SET created_at = ? WHERE id ="
            " (SELECT MAX(id) FROM work_item_events WHERE action = 'claimed')",
            (stamp(at).replace(".000Z", "Z"),),
        )
        self.conn.commit()

    def ticks(self, *ranges: tuple[float, float]) -> None:
        """A tick each minute across each range, so the intervals are what the case says."""

        for start, end in ranges:
            moment = start
            while moment < end:
                liveness.tick(self.store_path, epoch(moment))
                moment += MINUTE
            liveness.tick(self.store_path, epoch(end))

    def read(self, *, seconds: float = 30.0) -> bool:
        return self.collector.run_pass(self.said.append, seconds)

    def segments(self, session: str = "sess-1", agent: str = "") -> list[sqlite3.Row]:
        self.reader.row_factory = sqlite3.Row
        return self.reader.execute(
            "SELECT * FROM usage_segments WHERE session_id = ? AND agent_id = ? ORDER BY started_at, id",
            (session, agent),
        ).fetchall()

    def run_row(self, session: str = "sess-1", agent: str = "") -> sqlite3.Row:
        return self.reader.execute(
            "SELECT * FROM usage_runs WHERE session_id = ? AND agent_id = ?", (session, agent)
        ).fetchone()

    def seconds(self, session: str = "sess-1", agent: str = "") -> float:
        return round(sum(float(row["seconds"]) for row in self.segments(session, agent)), 3)

    def tokens(self, column: str, session: str = "sess-1", agent: str = "") -> int | None:
        values = [row[column] for row in self.segments(session, agent) if row[column] is not None]
        return sum(values) if values else None
