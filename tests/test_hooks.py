"""`valkama hook`: what a client hook records, where it goes when it cannot, and what it prints.

The contract with the client is the strictest one in the product: exit 0 and
print nothing, whatever arrives on stdin and whatever state the store is in.
The cases that state it run the real entry point in a child process, because
an exit status and a stdout are properties of a process. The rest drive the
modules in-process against throwaway stores.

The expected session states come from the session lifecycle the HTTP ingest
path already implements (`sessions.op_ingest_session_event`) and from the
spool rules of the hook contract: a replay inserts nothing, and an event older
than what the store already knows is history only.
"""

from __future__ import annotations

import io
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from server import housekeeping, sessions, store
from server.hooks import entry, ingest, normalize, spool

UID_A = "00000000-0000-4000-8000-00000000000a"
UID_B = "00000000-0000-4000-8000-00000000000b"
UID_C = "00000000-0000-4000-8000-00000000000c"

#: The PreToolUse input Claude Code sent in the identity prototype, trimmed to
#: the fields this transform reads plus the ones it must leave alone.
P1_PRE_TOOL_USE = {
    "session_id": "6f1c2a8e-0000-4000-8000-000000000001",
    "prompt_id": "550e8400-e29b-41d4-a716-446655440000",
    "transcript_path": "D:/transcripts/6f1c.jsonl",
    "cwd": "C:/work",
    "permission_mode": "default",
    "hook_event_name": "PreToolUse",
    "tool_name": "mcp__valkama__claim_work_item",
    "tool_input": {"reference": "переход → готово", "author": "agent", "nested": {"keep": [1, 2]}},
    "tool_use_id": "toolu_01ABC",
    "mcp_server": "valkama",
}


def lifecycle(
    client: str = "claude",
    event: str = "session-start",
    *,
    uid: str = UID_A,
    at: str = "2026-10-31T10:00:00.000Z",
    **payload: object,
) -> normalize.HookEvent:
    payload.setdefault("session_id", "S")
    record = normalize.lifecycle_event(client, event, payload, event_uid=uid, occurred_at=at)
    assert record is not None
    return record


class StoreCase(unittest.TestCase):
    """A throwaway store at the current schema, and the spool beside it."""

    def setUp(self) -> None:
        self.home = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.home.cleanup)
        self.path = os.path.join(self.home.name, "store", "valkama.sqlite3")
        patch = mock.patch.dict(
            os.environ,
            {"VALKAMA_DB": self.path, "HOME": self.home.name, "USERPROFILE": self.home.name},
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.spool = spool.directory(self.path)

    def light(self) -> sqlite3.Connection:
        conn = ingest.open_light(self.path, store.STORE_SCHEMA_VERSION)
        self.addCleanup(conn.close)
        return conn

    def session(self, session_id: str = "S") -> sqlite3.Row | None:
        return self.conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()

    def events(self) -> list[sqlite3.Row]:
        return self.conn.execute("SELECT * FROM execution_events ORDER BY id").fetchall()

    def spool_event(self, record: normalize.HookEvent, reason: str = "busy") -> str:
        return spool.write(
            self.spool,
            record,
            occurred_ns=int(record.occurred_at[17:19]) * 10**9 + 1,
            spooled_at="2026-10-31T11:00:00.000Z",
            reason=reason,
        )


class NormalizeTests(unittest.TestCase):
    def test_a_lifecycle_input_keeps_only_the_allowlisted_fields(self) -> None:
        private = "do-not-store-this"
        record = normalize.lifecycle_event(
            "codex",
            "user-prompt-submit",
            {
                "session_id": "thread-1",
                "turn_id": "turn_9",
                "cwd": "C:/work",
                "model": "gpt-x",
                "permission_mode": "default",
                "hook_event_name": "UserPromptSubmit",
                "prompt": private,
                "tool_input": {"command": private},
                "last_assistant_message": private,
                "x-codex-turn-metadata": {"workspaces": [private]},
            },
            event_uid=UID_A,
            occurred_at="2026-10-31T10:00:00.000Z",
        )
        assert record is not None
        self.assertEqual(("prompt", "UserPromptSubmit"), (record.kind, record.hook_event))
        self.assertEqual(
            ("thread-1", "turn_9", "gpt-x"), (record.session_id, record.turn_id, record.model)
        )
        line = normalize.spool_line(record, spooled_at="2026-10-31T10:00:01.000Z", reason="busy")
        self.assertNotIn(private.encode(), line)

    def test_claude_reports_its_turn_as_the_prompt_id(self) -> None:
        record = lifecycle("claude", "stop", prompt_id="p-1", turn_id="ignored")
        self.assertEqual("p-1", record.turn_id)

    def test_each_kind_keeps_its_own_extra_field(self) -> None:
        self.assertEqual("resume", lifecycle(event="session-start", source="resume").source)
        self.assertEqual("clear", lifecycle(event="session-end", reason="clear").reason)
        stopped = lifecycle(
            event="subagent-stop", agent_id="a1", agent_transcript_path="C:/t/agent.jsonl"
        )
        self.assertEqual("C:/t/agent.jsonl", stopped.agent_transcript_path)
        # A field outside the event's own list is not read even when present.
        self.assertIsNone(lifecycle(event="stop", source="resume", reason="x").source)

    def test_nothing_is_recorded_without_an_attributable_session(self) -> None:
        make = normalize.lifecycle_event
        cases = {
            "no session id": ("claude", "stop", {"cwd": "C:/w"}),
            "blank session id": ("claude", "stop", {"session_id": " \x01 "}),
            "over-long session id": ("claude", "stop", {"session_id": "s" * 129}),
            "codex has no Notification": ("codex", "notification", {"session_id": "S"}),
            "unknown client": ("cursor", "stop", {"session_id": "S"}),
            "input names another hook": (
                "claude",
                "stop",
                {"session_id": "S", "hook_event_name": "SessionEnd"},
            ),
        }
        for name, (client, event, payload) in cases.items():
            with self.subTest(name):
                self.assertIsNone(
                    make(
                        client,
                        event,
                        payload,
                        event_uid=UID_A,
                        occurred_at="2026-10-31T10:00:00.000Z",
                    )
                )

    def test_control_characters_are_dropped_and_extended_paths_normalized(self) -> None:
        record = lifecycle(
            session_id="S\x00\x1b",
            cwd="\\\\?\\C:\\work",
            transcript_path="\\\\?\\UNC\\host\\share\\t.jsonl",
        )
        self.assertEqual("S", record.session_id)
        self.assertEqual("C:\\work", record.cwd)
        self.assertEqual("\\\\host\\share\\t.jsonl", record.transcript_path)

    def test_a_spool_line_reads_back_as_the_same_event(self) -> None:
        record = lifecycle(agent_id="a1", agent_type="Explore", cwd="C:/w", source="startup")
        line = json.loads(
            normalize.spool_line(record, spooled_at="2026-10-31T10:00:01.000Z", reason="busy")
        )
        self.assertEqual((record, "2026-10-31T10:00:01.000Z"), normalize.read_spool_line(line))

    def test_a_stored_line_of_another_shape_is_refused(self) -> None:
        record = lifecycle()
        good = json.loads(
            normalize.spool_line(record, spooled_at="2026-10-31T10:00:01.000Z", reason="busy")
        )
        changes = {
            "unknown version": {"v": 2},
            "unknown key": {"prompt": "x"},
            "kind does not match the hook": {"kind": "session_end"},
            "unknown client": {"client": "cursor"},
            "bad uid": {"event_uid": "1"},
            "bad time": {"occurred_at": "yesterday"},
            "bad spooled_at": {"spooled_at": 5},
            "no reason": {"spool_reason": None},
            "wrong type": {"cwd": 5},
            "empty session": {"session_id": ""},
            "missing field": {"session_id": None},
            # Unhashable values used to reach a dictionary lookup and raise.
            "client is a list": {"client": ["x"]},
            "hook_event is an object": {"hook_event": {}},
            "kind is a list": {"kind": ["turn_end"]},
            "version is a boolean": {"v": True},
            "version is a list": {"v": [1]},
        }
        for name, change in changes.items():
            with self.subTest(name):
                line = {**good, **change}
                if change.get("session_id", "") is None:
                    del line["session_id"]
                self.assertIsNone(normalize.read_spool_line(line))

    def test_parse_input_answers_only_a_json_object(self) -> None:
        self.assertEqual({"a": 1}, normalize.parse_input(b'{"a": 1}'))
        for raw in (b"", b"\xff\xfe", b"[1]", b"not json", b'"text"'):
            with self.subTest(raw=raw):
                self.assertIsNone(normalize.parse_input(raw))


class IdentityTransformTests(unittest.TestCase):
    def test_the_original_arguments_gain_identity_and_nothing_else_changes(self) -> None:
        output = normalize.identity_output(json.loads(json.dumps(P1_PRE_TOOL_USE)))
        assert output is not None
        specific = output["hookSpecificOutput"]
        self.assertEqual("PreToolUse", specific["hookEventName"])
        # Rewriting the input is not a permission decision; none is granted.
        self.assertNotIn("permissionDecision", specific)
        updated = dict(specific["updatedInput"])
        identity = updated.pop("_identity")
        self.assertEqual(P1_PRE_TOOL_USE["tool_input"], updated)
        self.assertEqual(
            {"session_id": P1_PRE_TOOL_USE["session_id"], "tool_use_id": "toolu_01ABC"}, identity
        )

    def test_inside_a_subagent_the_agent_is_named(self) -> None:
        output = normalize.identity_output(
            {**P1_PRE_TOOL_USE, "agent_id": "a7", "agent_type": "Explore"}
        )
        assert output is not None
        identity = output["hookSpecificOutput"]["updatedInput"]["_identity"]
        self.assertEqual(("a7", "Explore"), (identity["agent_id"], identity["agent_type"]))

    def test_an_identity_the_model_wrote_is_replaced(self) -> None:
        forged = {**P1_PRE_TOOL_USE, "tool_input": {"_identity": {"session_id": "someone-else"}}}
        output = normalize.identity_output(forged)
        assert output is not None
        identity = output["hookSpecificOutput"]["updatedInput"]["_identity"]
        self.assertEqual(P1_PRE_TOOL_USE["session_id"], identity["session_id"])

    def test_malformed_input_gives_no_output(self) -> None:
        cases = {
            "not an MCP tool": {"tool_name": "Bash"},
            "arguments are not an object": {"tool_input": ["x"]},
            "no tool use id": {"tool_use_id": ""},
            "no session": {"session_id": None},
            "another hook": {"hook_event_name": "PostToolUse"},
        }
        for name, change in cases.items():
            with self.subTest(name):
                self.assertIsNone(normalize.identity_output({**P1_PRE_TOOL_USE, **change}))


class SessionTouchTests(StoreCase):
    def test_a_new_row_starts_and_is_seen_at_the_event_time(self) -> None:
        self.assertTrue(
            sessions.touch(self.conn, "S", client="claude", at="2026-10-31T10:00:00.250Z")
        )
        row = self.session()
        assert row is not None
        self.assertEqual(("claude", "active"), (row["client"], row["status"]))
        self.assertEqual("2026-10-31T10:00:00Z", row["started_at"])
        self.assertEqual("2026-10-31T10:00:00Z", row["last_seen"])

    def test_an_older_time_is_history_and_never_moves_the_heartbeat_back(self) -> None:
        sessions.touch(self.conn, "S", client="claude", at="2026-10-31T10:05:00.000Z", cwd="C:/new")
        current = sessions.touch(
            self.conn, "S", client="claude", at="2026-10-31T10:00:00.999Z", cwd="C:/old"
        )
        self.assertFalse(current)
        row = self.session()
        assert row is not None
        self.assertEqual(("2026-10-31T10:05:00Z", "C:/new"), (row["last_seen"], row["cwd"]))

    def test_the_same_second_is_current_and_a_later_one_advances(self) -> None:
        sessions.touch(self.conn, "S", client="claude", at="2026-10-31T10:00:00.900Z")
        self.assertTrue(
            sessions.touch(self.conn, "S", client="claude", at="2026-10-31T10:00:00.100Z")
        )
        self.assertTrue(
            sessions.touch(
                self.conn, "S", client="claude", at="2026-10-31T10:00:07.000Z", cwd="C:/w"
            )
        )
        row = self.session()
        assert row is not None
        self.assertEqual(("2026-10-31T10:00:07Z", "C:/w"), (row["last_seen"], row["cwd"]))

    def test_a_time_that_is_not_a_timestamp_is_refused(self) -> None:
        with self.assertRaises(ValueError):
            sessions.touch(self.conn, "S", client="claude", at="now")

    def test_an_unknown_transition_is_refused(self) -> None:
        with self.assertRaises(ValueError):
            sessions.transition(self.conn, "S", "paused", at="2026-10-31T10:00:00.000Z")


class IngestTests(StoreCase):
    def write(self, *records: normalize.HookEvent) -> int:
        return ingest.write(self.light(), [(record, None) for record in records], delivery="direct")

    def test_a_hook_session_reads_like_an_http_ingested_one(self) -> None:
        self.write(lifecycle(event="session-start", session_id="hooked", cwd="C:/w"))
        sessions.op_ingest_session_event(
            self.conn,
            {"session_id": "posted", "client": "claude", "event": "session_start", "cwd": "C:/w"},
        )
        hooked = sessions.session_context(self.conn, "hooked")
        posted = sessions.session_context(self.conn, "posted")
        for key in ("resolved", "client", "client_family", "cwd", "status", "work_item"):
            with self.subTest(key=key):
                self.assertEqual(posted[key], hooked[key])
        [event] = self.events()
        self.assertEqual(
            ("session_start", "confirmed", "hook", "direct", "SessionStart", "claude"),
            (
                event["kind"],
                event["identity_state"],
                event["identity_source"],
                event["delivery"],
                event["hook_event"],
                event["client"],
            ),
        )

    def test_the_lifecycle_moves_the_session_like_http_ingest_does(self) -> None:
        self.write(lifecycle(event="session-start", uid=UID_A, at="2026-10-31T10:00:00.000Z"))
        self.write(lifecycle(event="stop", uid=UID_B, at="2026-10-31T10:01:00.000Z"))
        row = self.session()
        assert row is not None
        self.assertEqual(("active", "waiting"), (row["status"], row["attention"]))
        self.write(lifecycle(event="user-prompt-submit", uid=UID_C, at="2026-10-31T10:02:00.000Z"))
        row = self.session()
        assert row is not None
        self.assertEqual(("active", ""), (row["status"], row["attention"]))
        self.write(
            lifecycle(
                event="session-end",
                uid="00000000-0000-4000-8000-00000000000d",
                at="2026-10-31T10:03:00.000Z",
            )
        )
        row = self.session()
        assert row is not None
        self.assertEqual(
            ("ended", "ended", "2026-10-31T10:03:00Z"),
            (row["status"], row["attention"], row["ended_at"]),
        )

    def test_a_notification_marks_only_a_live_session_blocked(self) -> None:
        self.write(lifecycle(event="notification", uid=UID_A))
        row = self.session()
        assert row is not None
        self.assertEqual("blocked", row["attention"])

    def test_the_same_event_twice_is_one_row_and_one_transition(self) -> None:
        start = lifecycle(event="session-start", at="2026-10-31T10:00:00.000Z")
        self.assertEqual(1, self.write(start))
        self.write(lifecycle(event="session-end", uid=UID_B, at="2026-10-31T10:00:01.000Z"))
        # Delivered again, the start must not reopen the session it began.
        self.assertEqual(0, self.write(start))
        self.assertEqual(2, len(self.events()))
        row = self.session()
        assert row is not None
        self.assertEqual("ended", row["status"])

    def test_a_subagent_has_its_own_row_under_its_parent(self) -> None:
        self.write(lifecycle(event="session-start", uid=UID_A, at="2026-10-31T10:00:00.000Z"))
        self.write(
            lifecycle(
                event="subagent-start",
                uid=UID_B,
                agent_id="a1",
                agent_type="Explore",
                at="2026-10-31T10:00:05.000Z",
            )
        )
        child = self.session("S:a1")
        assert child is not None
        self.assertEqual(
            ("S", "a1", "active"), (child["parent_session_id"], child["agent_id"], child["status"])
        )
        self.write(
            lifecycle(
                event="subagent-stop",
                uid=UID_C,
                agent_id="a1",
                agent_transcript_path="C:/t/agent-a1.jsonl",
                at="2026-10-31T10:00:09.000Z",
            )
        )
        child = self.session("S:a1")
        parent = self.session("S")
        assert child is not None and parent is not None
        self.assertEqual(
            ("ended", "C:/t/agent-a1.jsonl"), (child["status"], child["transcript_path"])
        )
        self.assertEqual(
            ("active", "2026-10-31T10:00:09Z"), (parent["status"], parent["last_seen"])
        )
        self.assertEqual("C:/t/agent-a1.jsonl", self.events()[-1]["transcript_path"])

    def test_a_subagent_event_without_an_agent_leaves_the_parent_state_alone(self) -> None:
        self.write(lifecycle(event="session-end", uid=UID_A, at="2026-10-31T10:00:00.000Z"))
        self.write(lifecycle(event="subagent-start", uid=UID_B, at="2026-10-31T10:00:05.000Z"))
        row = self.session()
        assert row is not None
        self.assertEqual(("ended", "2026-10-31T10:00:05Z"), (row["status"], row["last_seen"]))

    def test_a_session_start_with_an_agent_type_but_no_agent_is_the_top_session(self) -> None:
        self.write(lifecycle(event="session-start", agent_type="reviewer"))
        self.assertIsNotNone(self.session("S"))
        self.assertEqual(1, self.conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0])


class LightOpenTests(StoreCase):
    def deliver(self, record: normalize.HookEvent) -> str:
        return ingest.deliver(
            record,
            store_path=self.path,
            schema_version=store.STORE_SCHEMA_VERSION,
            occurred_ns=1_793_000_000_000_000_000,
            now="2026-10-31T10:00:00.500Z",
        )

    def test_with_no_server_an_event_reaches_the_store(self) -> None:
        self.assertEqual("direct", self.deliver(lifecycle()))
        self.assertEqual(1, len(self.events()))
        self.assertEqual([], spool.pending(self.spool))

    def test_a_locked_store_spools_and_the_event_lands_after_release(self) -> None:
        holder = sqlite3.connect(self.path, isolation_level=None)
        self.addCleanup(holder.close)
        holder.execute("BEGIN EXCLUSIVE")
        self.assertEqual("busy", self.deliver(lifecycle()))
        holder.execute("ROLLBACK")
        [name] = spool.pending(self.spool)
        with open(os.path.join(self.spool, name), encoding="utf-8") as handle:
            line = json.loads(handle.read())
        self.assertEqual(
            ("busy", "2026-10-31T10:00:00.500Z"), (line["spool_reason"], line["spooled_at"])
        )
        result = housekeeping.drain_spool(self.conn)
        self.assertEqual((1, 1, 0), (result.files, result.inserted, result.rejected))
        [event] = self.events()
        self.assertEqual(
            ("spooled", "2026-10-31T10:00:00.500Z"), (event["delivery"], event["spooled_at"])
        )
        self.assertEqual([], spool.pending(self.spool))

    def test_another_schema_version_spools(self) -> None:
        reason = ingest.deliver(
            lifecycle(),
            store_path=self.path,
            schema_version=store.STORE_SCHEMA_VERSION + 1,
            occurred_ns=1,
            now="2026-10-31T10:00:00.500Z",
        )
        self.assertEqual("schema", reason)
        self.assertEqual(1, len(spool.pending(self.spool)))
        self.assertEqual([], self.events())

    def test_a_missing_store_spools_and_is_not_created(self) -> None:
        missing = os.path.join(self.home.name, "elsewhere", "valkama.sqlite3")
        os.makedirs(os.path.dirname(missing))
        reason = ingest.deliver(
            lifecycle(),
            store_path=missing,
            schema_version=store.STORE_SCHEMA_VERSION,
            occurred_ns=1,
            now="2026-10-31T10:00:00.500Z",
        )
        self.assertEqual("missing", reason)
        self.assertFalse(os.path.exists(missing))
        self.assertEqual(1, len(spool.pending(spool.directory(missing))))

    def test_a_missing_store_directory_is_never_created(self) -> None:
        # Its existence is what tells the first full open that no store from an
        # earlier product name waits to be adopted.
        root = os.path.join(self.home.name, "never-opened")
        with self.assertRaises(FileNotFoundError):
            ingest.deliver(
                lifecycle(),
                store_path=os.path.join(root, "valkama.sqlite3"),
                schema_version=store.STORE_SCHEMA_VERSION,
                occurred_ns=1,
                now="2026-10-31T10:00:00.500Z",
            )
        self.assertFalse(os.path.exists(root))

    def test_a_current_version_store_without_the_execution_tree_spools(self) -> None:
        # A schema-9 store an earlier build wrote has no `execution_events` yet.
        bare = os.path.join(self.home.name, "bare", "valkama.sqlite3")
        os.makedirs(os.path.dirname(bare))
        made = sqlite3.connect(bare)
        made.execute(f"PRAGMA user_version={store.STORE_SCHEMA_VERSION}")
        made.close()
        reason = ingest.deliver(
            lifecycle(),
            store_path=bare,
            schema_version=store.STORE_SCHEMA_VERSION,
            occurred_ns=1,
            now="2026-10-31T10:00:00.500Z",
        )
        self.assertEqual("error", reason)
        self.assertEqual(1, len(spool.pending(spool.directory(bare))))

    def test_a_direct_write_drains_what_waited(self) -> None:
        self.spool_event(lifecycle(event="session-start", uid=UID_B, at="2026-10-31T09:59:00.000Z"))
        self.assertEqual("direct", self.deliver(lifecycle(event="stop", uid=UID_A)))
        self.assertEqual({"direct", "spooled"}, {row["delivery"] for row in self.events()})
        self.assertEqual([], spool.pending(self.spool))


class DrainTests(StoreCase):
    def test_replaying_a_file_twice_inserts_nothing_new(self) -> None:
        path = self.spool_event(lifecycle())
        copy = path + ".copy"
        shutil.copyfile(path, copy)
        first = ingest.drain(self.conn, self.spool)
        os.replace(copy, path)
        second = ingest.drain(self.conn, self.spool)
        self.assertEqual((1, 0), (first.inserted, second.inserted))
        self.assertEqual(1, len(self.events()))
        self.assertEqual([], spool.pending(self.spool))

    def test_a_crash_between_commit_and_delete_replays_as_no_ops(self) -> None:
        start = lifecycle(event="session-start", uid=UID_A, at="2026-10-31T10:00:00.000Z")
        path = self.spool_event(start)
        # The drain committed this file, then died before removing it.
        ingest.write(self.conn, spool.read(path) or [], delivery="spooled")
        ingest.write(
            self.conn,
            [(lifecycle(event="session-end", uid=UID_B, at="2026-10-31T10:00:01.000Z"), None)],
            delivery="direct",
        )
        result = ingest.drain(self.conn, self.spool)
        self.assertEqual((1, 0), (result.files, result.inserted))
        row = self.session()
        assert row is not None
        self.assertEqual("ended", row["status"])

    def test_draining_old_events_never_makes_an_ended_session_live(self) -> None:
        ingest.write(
            self.conn,
            [(lifecycle(event="session-end", uid=UID_A, at="2026-10-31T12:00:00.000Z"), None)],
            delivery="direct",
        )
        self.spool_event(lifecycle(event="session-start", uid=UID_B, at="2026-10-31T10:00:00.000Z"))
        self.spool_event(
            lifecycle(event="user-prompt-submit", uid=UID_C, at="2026-10-31T10:00:30.000Z")
        )
        result = ingest.drain(self.conn, self.spool)
        self.assertEqual(2, result.inserted)
        row = self.session()
        assert row is not None
        self.assertEqual(
            ("ended", "ended", "2026-10-31T12:00:00Z"),
            (row["status"], row["attention"], row["last_seen"]),
        )

    def test_files_drain_in_the_order_they_happened(self) -> None:
        self.spool_event(lifecycle(event="session-end", uid=UID_B, at="2026-10-31T10:00:09.000Z"))
        self.spool_event(lifecycle(event="session-start", uid=UID_A, at="2026-10-31T10:00:01.000Z"))
        ingest.drain(self.conn, self.spool)
        self.assertEqual(["session_start", "session_end"], [row["kind"] for row in self.events()])
        row = self.session()
        assert row is not None
        self.assertEqual("ended", row["status"])

    def test_an_unreadable_file_is_set_aside_and_counted(self) -> None:
        os.makedirs(self.spool, exist_ok=True)
        for name, body in (
            ("00000000000000000001-a.jsonl", b"not json\n"),
            ("00000000000000000002-b.jsonl", b'{"v": 99}\n'),
            ("00000000000000000003-c.jsonl", b"\n"),
        ):
            with open(os.path.join(self.spool, name), "wb") as handle:
                handle.write(body)
        self.spool_event(lifecycle())
        result = ingest.drain(self.conn, self.spool)
        self.assertEqual((1, 1, 3), (result.files, result.inserted, result.rejected))
        self.assertEqual({"pending": 0, "oldest": None, "rejected": 3}, spool.summary(self.spool))

    def test_no_file_content_makes_a_drain_raise(self) -> None:
        good = json.loads(
            normalize.spool_line(lifecycle(), spooled_at="2026-10-31T10:00:01.000Z", reason="busy")
        )
        os.makedirs(self.spool, exist_ok=True)
        bodies = {
            "1-client.jsonl": {**good, "client": ["x"]},
            "2-hook.jsonl": {**good, "hook_event": {}},
            "3-kind.jsonl": {**good, "kind": {"a": 1}},
            "4-reason.jsonl": {**good, "spool_reason": ["busy"]},
        }
        for name, body in bodies.items():
            with open(os.path.join(self.spool, name), "wb") as handle:
                handle.write(json.dumps(body).encode("utf-8") + b"\n")
        result = ingest.drain(self.conn, self.spool)
        self.assertEqual((0, 4), (result.files, result.rejected))
        self.assertEqual({"pending": 0, "oldest": None, "rejected": 4}, spool.summary(self.spool))

    def test_an_unexpected_failure_on_one_file_sets_it_aside_and_the_drain_goes_on(self) -> None:
        self.spool_event(lifecycle(uid=UID_A, at="2026-10-31T10:00:01.000Z"))
        self.spool_event(lifecycle(uid=UID_B, at="2026-10-31T10:00:02.000Z"))
        real = ingest.record
        calls = iter([True, False])

        def flaky(conn: sqlite3.Connection, event: normalize.HookEvent, **kwargs: object) -> bool:
            if next(calls):
                raise ValueError("a value the store refused to interpret")
            return real(conn, event, **kwargs)  # type: ignore[arg-type]

        with mock.patch.object(ingest, "record", side_effect=flaky):
            result = ingest.drain(self.conn, self.spool)
        self.assertEqual((1, 1, 1), (result.files, result.inserted, result.rejected))
        self.assertFalse(self.conn.in_transaction)

    def test_a_bounded_drain_leaves_the_rest_for_later(self) -> None:
        for number, uid in enumerate((UID_A, UID_B, UID_C)):
            self.spool_event(lifecycle(uid=uid, at=f"2026-10-31T10:00:0{number}.000Z"))
        self.assertEqual(2, ingest.drain(self.conn, self.spool, max_files=2).files)
        self.assertEqual(0, ingest.drain(self.conn, self.spool, seconds=0).files)
        self.assertEqual(1, len(spool.pending(self.spool)))

    def test_a_store_error_stops_the_drain_and_keeps_the_file(self) -> None:
        self.spool_event(lifecycle())
        self.conn.execute("BEGIN")
        result = ingest.drain(self.conn, self.spool)
        # The caller's own transaction survives the refused drain.
        self.assertTrue(self.conn.in_transaction)
        self.conn.rollback()
        self.assertTrue(result.stopped)
        self.assertEqual(1, len(spool.pending(self.spool)))

    def test_the_spool_reports_its_oldest_pending_event(self) -> None:
        self.assertEqual({"pending": 0, "oldest": None, "rejected": 0}, spool.summary(self.spool))
        spool.write(
            self.spool,
            lifecycle(),
            occurred_ns=1_793_000_000_123_000_000,
            spooled_at="2026-10-31T10:00:00.000Z",
            reason="busy",
        )
        summary = spool.summary(self.spool)
        self.assertEqual(
            (1, normalize.timestamp(1_793_000_000_123_000_000)),
            (summary["pending"], summary["oldest"]),
        )
        self.assertEqual([], [name for name in os.listdir(self.spool) if name.endswith(".tmp")])


class EntryTests(StoreCase):
    """The command in-process, for what the subprocess cases cannot measure."""

    def run_hook(self, *argv: str, stdin: bytes) -> tuple[int, bytes, str]:
        out = io.BytesIO()
        err = io.StringIO()
        with mock.patch.object(sys, "stderr", err):
            code = entry.main(list(argv), io.BytesIO(stdin), out)
        return code, out.getvalue(), err.getvalue()

    def test_a_lifecycle_event_is_written_and_prints_nothing(self) -> None:
        code, out, _ = self.run_hook(
            "codex", "session-start", stdin=b'{"session_id": "thread-1", "cwd": "C:/w"}'
        )
        self.assertEqual((0, b""), (code, out))
        row = self.session("thread-1")
        assert row is not None
        self.assertEqual("codex", row["client"])

    def test_pre_tool_use_prints_the_identity_output(self) -> None:
        code, out, _ = self.run_hook(
            "claude", "pre-tool-use", stdin=json.dumps(P1_PRE_TOOL_USE).encode()
        )
        self.assertEqual(0, code)
        updated = json.loads(out.decode("utf-8"))["hookSpecificOutput"]["updatedInput"]
        self.assertEqual("переход → готово", updated["reference"])

    def test_misuse_and_garbage_print_nothing_and_exit_zero(self) -> None:
        cases = {
            "no arguments": ((), b"{}"),
            "unknown event": (("claude", "teleport"), b'{"session_id": "S"}'),
            "codex has no transform": (
                ("codex", "pre-tool-use"),
                json.dumps(P1_PRE_TOOL_USE).encode(),
            ),
            "garbage": (("claude", "session-start"), b"\x00\xff garbage"),
            "oversized": (("claude", "pre-tool-use"), b" " * (entry.MAX_INPUT_BYTES + 1)),
            "no session": (("claude", "stop"), b'{"cwd": "C:/w"}'),
        }
        for name, (argv, stdin) in cases.items():
            with self.subTest(name):
                code, out, _ = self.run_hook(*argv, stdin=stdin)
                self.assertEqual((0, b""), (code, out))
        self.assertEqual([], self.events())

    def test_an_unexpected_failure_is_reported_on_stderr_only(self) -> None:
        with mock.patch.object(ingest, "deliver", side_effect=OSError("disk full")):
            code, out, err = self.run_hook("claude", "stop", stdin=b'{"session_id": "S"}')
        self.assertEqual((0, b""), (code, out))
        self.assertIn("disk full", err)


class EntryProcessTests(unittest.TestCase):
    """The real entry point as a client runs it: exit status and stdout."""

    def setUp(self) -> None:
        self.home = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.home.cleanup)
        self.path = os.path.join(self.home.name, "store", "valkama.sqlite3")
        os.makedirs(os.path.dirname(self.path))
        self.env = {
            **os.environ,
            "VALKAMA_DB": self.path,
            "HOME": self.home.name,
            "USERPROFILE": self.home.name,
        }

    def hook(self, client: str, event: str, stdin: bytes) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, os.path.join(ROOT, "valkama.py"), "hook", client, event],
            input=stdin,
            capture_output=True,
            env=self.env,
            timeout=60,
            check=False,
        )

    def test_every_lifecycle_case_exits_zero_with_empty_stdout(self) -> None:
        cases = (
            ("claude", "session-start", b'{"session_id": "S", "cwd": "C:/w"}'),
            ("codex", "stop", b'{"session_id": "S", "turn_id": "t"}'),
            ("claude", "session-end", b"\xff garbage \x00"),
            ("codex", "notification", b'{"session_id": "S"}'),
            ("claude", "stop", b""),
        )
        for client, event, stdin in cases:
            with self.subTest(client=client, event=event):
                done = self.hook(client, event, stdin)
                self.assertEqual((0, b""), (done.returncode, done.stdout), done.stderr[:400])
        # No store existed, so the two valid events wait in the spool.
        self.assertEqual(2, len(spool.pending(spool.directory(self.path))))
        self.assertFalse(os.path.exists(self.path))

    def test_pre_tool_use_answers_on_stdout_and_exits_zero(self) -> None:
        done = self.hook(
            "claude", "pre-tool-use", json.dumps(P1_PRE_TOOL_USE, ensure_ascii=False).encode()
        )
        self.assertEqual(0, done.returncode, done.stderr[:400])
        updated = json.loads(done.stdout.decode("utf-8"))["hookSpecificOutput"]["updatedInput"]
        self.assertEqual("toolu_01ABC", updated["_identity"]["tool_use_id"])
        self.assertEqual(P1_PRE_TOOL_USE["tool_input"]["nested"], updated["nested"])
        malformed = self.hook("claude", "pre-tool-use", b'{"tool_name": "mcp__valkama__x"}')
        self.assertEqual((0, b""), (malformed.returncode, malformed.stdout))

    def test_the_identity_transform_loads_no_store_and_a_hook_no_surface(self) -> None:
        script = (
            "import io, json, sys\n"
            "from server.hooks import entry\n"
            "out = io.BytesIO()\n"
            "entry.main(['claude', 'pre-tool-use'], io.BytesIO(sys.stdin.buffer.read()), out)\n"
            "transform = sorted(m for m in sys.modules if m.startswith('server.'))\n"
            "entry.main(['claude', 'stop'], io.BytesIO(b'{\"session_id\": \"S\"}'), io.BytesIO())\n"
            "lifecycle = sorted(m for m in sys.modules if m.startswith('server.'))\n"
            "sys.stdout.write(json.dumps([bool(out.getvalue()), transform, lifecycle]))\n"
        )
        done = subprocess.run(
            [sys.executable, "-c", script],
            input=json.dumps(P1_PRE_TOOL_USE).encode(),
            capture_output=True,
            cwd=ROOT,
            env=self.env,
            timeout=60,
            check=True,
        )
        answered, transform, lifecycle_modules = json.loads(done.stdout)
        self.assertTrue(answered)
        self.assertNotIn("server.store", transform)
        self.assertEqual(
            {"server.hooks", "server.hooks.entry", "server.hooks.normalize"}, set(transform)
        )
        self.assertIn("server.store", lifecycle_modules)
        for surface in ("server.cli", "server.mcp_surface", "server.http_surface"):
            self.assertNotIn(surface, lifecycle_modules)


if __name__ == "__main__":
    unittest.main()
