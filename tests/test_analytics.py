"""Pure/temp-store checks for the read-only analytics projection."""

from __future__ import annotations

import inspect
import json
import os
import pathlib
import re
import tempfile
import time
import unittest
from typing import ClassVar
from unittest import mock

from server import analytics, http_surface, sessions, store
from server.analytics import executions as execution_analytics
from server.analytics import export as analytics_export
from server.analytics import portfolio as analytics_portfolio
from server.analytics import projection
from server.executions import service as execution_service
from server.planning import service as planning
from server.planning import service as planning_service
from tests import SUITE_STORE

#: The states the default workflow declares, in its order, each with its
#: category. `reconstruct_status_history` takes this instead of consulting a
#: constant, which is what lets a renamed state keep being counted.
DEFAULT_STATES = (
    ("backlog", "backlog"),
    ("todo", "queued"),
    ("dev", "active"),
    ("review", "review"),
    ("done", "completed"),
    ("blocked", "blocked"),
)


#: Name to key, so a test keeps naming a space the way it reads while the reads
#: that follow use the key the store assigned.
_KEYS: dict[str, str] = {}


def seed_space(conn, name: str) -> str:
    """One planning space, committed, returning the key it was given."""

    space = planning_service.create_planning_space(
        conn, project_id=re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "space", name=name
    )
    conn.commit()
    _KEYS[name] = str(space["key"])
    return str(space["key"])


def seed_item(conn, title: str, space: str, **fields) -> dict:
    """One work item, committed, as the record a read would answer with."""

    created = planning_service.create_work_item(conn, space=_KEYS[space], title=title, **fields)
    conn.commit()
    return created


def attach(conn, reference: str, kind: str, value: str) -> None:
    """One ref on one item, committed.

    The Planning service leaves the transaction to its caller, and a session
    ingest that follows needs it closed before it can take its own write lock.
    """

    planning_service.attach_ref(conn, reference, kind, value)
    conn.commit()


def key_for(name: str) -> str:
    """The key the store assigned to a space this module seeded by name."""

    return _KEYS[name]


def item_id(conn, reference: str) -> str:
    """The stored identity behind a reference, which an event row keys on."""

    return str(
        conn.execute(
            "SELECT w.work_item_id FROM work_items w"
            " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
            " WHERE p.key || '-' || w.number = ?",
            (reference,),
        ).fetchone()[0]
    )


def replace_events(conn, reference: str, rows) -> None:
    """The exact event trail one case wants, in place of what creation wrote.

    Several cases need a trail no sequence of operations would produce — a
    missing `created`, a transition with no predecessor — which is the point:
    the reconstruction has to stay honest about a store it did not write.
    """

    identity = item_id(conn, reference)
    conn.execute("DELETE FROM work_item_events WHERE work_item_id = ?", (identity,))
    conn.executemany(
        "INSERT INTO work_item_events(work_item_id, action, detail, author, created_at)"
        " VALUES (?,?,?,?,?)",
        [(identity, action, detail, author, stamp) for action, detail, author, stamp in rows],
    )
    conn.commit()


def backdate(conn, reference: str, stamp: str) -> None:
    """Move one item's events back in time, which several cases need."""

    conn.execute(
        "UPDATE work_item_events SET created_at = ?"
        " WHERE work_item_id = (SELECT w.work_item_id FROM work_items w"
        "  JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
        "  WHERE p.key || '-' || w.number = ?)",
        (stamp, reference),
    )
    conn.commit()


class AnalyticsTests(unittest.TestCase):
    def _write_codex_journal(self, path: str, session_id: str, input_tokens: int = 2) -> None:
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(
                json.dumps(
                    {
                        "type": "session_meta",
                        "payload": {"id": session_id},
                    }
                )
                + "\n"
            )
            handle.write(
                json.dumps(
                    {
                        "timestamp": "2026-01-01T00:00:00Z",
                        "type": "event_msg",
                        "payload": {
                            "token_count": {
                                "total_token_usage": {
                                    "input_tokens": input_tokens,
                                    "output_tokens": 1,
                                }
                            }
                        },
                    }
                )
                + "\n"
            )

    def test_explicit_and_inferred_segments_sum_repeated_visits(self) -> None:
        events = [
            {
                "id": 2,
                "action": "transitioned",
                "detail": "dev",
                "created_at": "2026-01-01T01:00:00Z",
            },
            {
                "id": 3,
                "action": "transitioned",
                "detail": "review",
                "created_at": "2026-01-01T03:00:00Z",
            },
            {
                "id": 1,
                "action": "created",
                "detail": "backlog",
                "created_at": "2026-01-01T00:00:00Z",
            },
            {
                "id": 4,
                "action": "transitioned",
                "detail": "dev",
                "created_at": "2026-01-01T04:00:00Z",
            },
            {
                "id": 5,
                "action": "transitioned",
                "detail": "done",
                "created_at": "2026-01-01T05:00:00Z",
            },
        ]
        result = analytics.reconstruct_status_history(
            events, DEFAULT_STATES, as_of="2026-01-01T06:00:00Z"
        )
        self.assertEqual("confirmed", result["coverage"])
        self.assertEqual(10800, result["status_time"]["dev"])
        self.assertEqual(2, result["visits"]["dev"])

    def test_missing_initial_is_partial_and_never_zero(self) -> None:
        result = analytics.reconstruct_status_history(
            [
                {
                    "id": 9,
                    "action": "transitioned",
                    "detail": "dev",
                    "created_at": "2026-01-01T02:00:00Z",
                }
            ],
            DEFAULT_STATES,
            as_of="2026-01-01T03:00:00Z",
        )
        self.assertEqual("partial", result["coverage"])
        self.assertIsNone(result["segments"][0]["duration_seconds"])

    def test_events_after_as_of_are_discarded_before_reconstruction(self) -> None:
        result = analytics.reconstruct_status_history(
            [{"id": 1, "action": "created", "detail": "dev", "created_at": "2026-01-02T00:00:00Z"}],
            DEFAULT_STATES,
            as_of="2026-01-01T00:00:00Z",
        )
        self.assertEqual("unknown", result["coverage"])
        self.assertIsNone(result["current_status"])
        self.assertIsNone(result["status_time"]["dev"])

    def test_malformed_lifecycle_record_cannot_claim_confirmed_history(self) -> None:
        result = analytics.reconstruct_status_history(
            [
                {
                    "id": 1,
                    "action": "transitioned",
                    "detail": "not-a-lane -> nowhere",
                    "created_at": "2026-01-01T00:00:00Z",
                }
            ],
            DEFAULT_STATES,
            as_of="2026-01-01T01:00:00Z",
        )
        self.assertEqual("partial", result["coverage"])
        self.assertIsNone(result["current_status"])

    def test_destination_only_transition_chains_from_the_previous_state(self) -> None:
        """A transition names where it went, and the reader supplies where from.

        The Board era wrote `dev -> done` and had to reconcile a declared
        source against the chain it had reconstructed; a disagreement made the
        preceding interval unknown. A destination-only detail cannot disagree,
        so the same trail is now fully confirmed.
        """

        result = analytics.reconstruct_status_history(
            [
                {
                    "id": 1,
                    "action": "created",
                    "detail": "backlog",
                    "created_at": "2026-01-01T00:00:00Z",
                },
                {
                    "id": 2,
                    "action": "transitioned",
                    "detail": "done",
                    "created_at": "2026-01-01T02:00:00Z",
                },
            ],
            DEFAULT_STATES,
            as_of="2026-01-01T03:00:00Z",
        )
        self.assertEqual("confirmed", result["coverage"])
        backlog = next(item for item in result["segments"] if item["status"] == "backlog")
        done = next(item for item in result["segments"] if item["status"] == "done")
        self.assertEqual(7200, backlog["duration_seconds"])
        self.assertEqual(3600, done["duration_seconds"])

    def test_lane_counts_follow_the_chained_state(self) -> None:
        """The dashboard's per-state rollup reads the same chain, per item."""

        with tempfile.TemporaryDirectory() as directory:
            os.environ["VALKAMA_DB"] = os.path.join(directory, "valkama.sqlite3")
            conn = store.connect()
            try:
                seed_space(conn, "Lane quality")
                confirmed = seed_item(conn, "chained", "Lane quality")
                partial = seed_item(conn, "gap", "Lane quality")
                replace_events(
                    conn,
                    confirmed["reference"],
                    (
                        ("created", "backlog", "agent", "2026-01-01T00:00:00Z"),
                        ("transitioned", "done", "agent", "2026-01-01T02:00:00Z"),
                    ),
                )
                # No creation event at all: the interval before the first
                # transition stays unknown instead of being counted from zero.
                replace_events(
                    conn,
                    partial["reference"],
                    (("transitioned", "done", "agent", "2026-01-01T02:00:00Z"),),
                )
                payload = analytics.project_space(
                    conn, key_for("Lane quality"), as_of="2026-01-01T03:00:00Z"
                )
                self.assertEqual(
                    1, payload["status_time"]["backlog"]["coverage_counts"]["confirmed"]
                )
                self.assertEqual(7200, payload["status_time"]["backlog"]["seconds"])
                done = payload["status_time"]["done"]["coverage_counts"]
                self.assertEqual({"confirmed": 1, "inferred": 0, "partial": 1, "unknown": 0}, done)
                self.assertEqual("partial", payload["status_time"]["done"]["coverage"])
            finally:
                conn.close()
                os.environ["VALKAMA_DB"] = SUITE_STORE

    def test_event_id_breaks_timestamp_ties(self) -> None:
        events = [
            {
                "id": 2,
                "action": "transitioned",
                "detail": "dev",
                "created_at": "2026-01-01T00:00:00Z",
            },
            {
                "id": 1,
                "action": "created",
                "detail": "backlog",
                "created_at": "2026-01-01T00:00:00Z",
            },
        ]
        result = analytics.reconstruct_status_history(
            events, DEFAULT_STATES, as_of="2026-01-01T01:00:00Z"
        )
        self.assertEqual("dev", result["current_status"])
        self.assertEqual(3600, result["status_time"]["dev"])

    def test_local_usage_dedupes_codex_cumulative_and_claude_message_ids(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            codex = os.path.join(directory, "rollout-codex.jsonl")
            with open(codex, "w", encoding="utf-8") as handle:
                handle.write(
                    json.dumps(
                        {
                            "session_id": "codex",
                            "type": "event_msg",
                            "payload": {
                                "token_count": {
                                    "total_token_usage": {"input_tokens": 2, "output_tokens": 1}
                                }
                            },
                        }
                    )
                    + "\n"
                )
                handle.write(
                    json.dumps(
                        {
                            "session_id": "codex",
                            "type": "event_msg",
                            "payload": {
                                "token_count": {
                                    "total_token_usage": {"input_tokens": 5, "output_tokens": 3}
                                }
                            },
                        }
                    )
                    + "\n"
                )
            usage = analytics.LocalJournalUsageProvider(codex_roots=[codex]).usage_for_session(
                "codex", "codex"
            )
            self.assertEqual({"input_tokens": 5, "output_tokens": 3}, usage["tokens"])

            claude = os.path.join(directory, "claude.jsonl")
            with open(claude, "w", encoding="utf-8") as handle:
                handle.writelines(
                    json.dumps(
                        {
                            "type": "assistant",
                            "message": {
                                "id": "m1",
                                "model": "x",
                                "usage": {"input_tokens": count},
                            },
                            "cost_usd": count / 2,
                        }
                    )
                    + "\n"
                    for count in (2, 4)
                )
                handle.write(
                    json.dumps(
                        {
                            "type": "assistant",
                            "message": {"id": "m2", "model": "x", "usage": {"input_tokens": 3}},
                            "cost_usd": 3,
                        }
                    )
                    + "\n"
                )
            usage = analytics.LocalJournalUsageProvider(claude_roots=[claude]).usage_for_session(
                "claude", "claude"
            )
            self.assertEqual(7, usage["tokens"]["input_tokens"])
            self.assertIsNone(usage["cost"])
            self.assertEqual("unknown", usage["cost_quality"])

    def test_codex_rollout_session_meta_identity_is_exact_and_observed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            session_id = "123e4567-e89b-12d3-a456-426614174000"
            rollout = os.path.join(
                directory,
                f"rollout-2026-08-07T00-46-21-{session_id}.jsonl",
            )
            with open(rollout, "w", encoding="utf-8") as handle:
                handle.write(
                    json.dumps(
                        {
                            "type": "session_meta",
                            "payload": {"id": session_id.upper(), "cwd": directory},
                        }
                    )
                    + "\n"
                )
                handle.write(
                    json.dumps(
                        {
                            "type": "event_msg",
                            "payload": {
                                "token_count": {
                                    "total_token_usage": {"input_tokens": 11, "output_tokens": 7}
                                }
                            },
                        }
                    )
                    + "\n"
                )
            usage = analytics.LocalJournalUsageProvider(
                codex_roots=[directory],
            ).usage_for_session(session_id, "codex")
            self.assertTrue(usage["observed"])
            self.assertEqual({"input_tokens": 11, "output_tokens": 7}, usage["tokens"])
            self.assertEqual("local_journal", usage["source"])
            self.assertEqual("derived/internal", usage["quality"])

    def test_coverage_rollup_keeps_confirmed_plus_unknown_partial(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            os.environ["VALKAMA_DB"] = os.path.join(directory, "valkama.sqlite3")
            conn = store.connect()
            try:
                seed_space(conn, "Rollup")
                confirmed = seed_item(conn, "confirmed", "Rollup")
                unknown = seed_item(conn, "future", "Rollup")
                backdate(conn, confirmed["reference"], "2026-01-01T00:00:00Z")
                backdate(conn, unknown["reference"], "2026-01-02T00:00:00Z")
                conn.commit()
                payload = analytics.project_space(
                    conn, key_for("Rollup"), as_of="2026-01-01T01:00:00Z"
                )
                self.assertEqual("partial", payload["history_coverage"]["overall"])
                self.assertEqual(1, payload["history_coverage"]["states"]["confirmed"])
                self.assertEqual(1, payload["history_coverage"]["states"]["unknown"])
                self.assertGreater(
                    payload["status_time"]["backlog"]["coverage_counts"]["unknown"], 0
                )
            finally:
                conn.close()
                os.environ["VALKAMA_DB"] = SUITE_STORE

    def test_ambiguous_journal_match_stays_unknown(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            first = os.path.join(directory, "one", "session.jsonl")
            second = os.path.join(directory, "two", "session.jsonl")
            os.makedirs(os.path.dirname(first))
            os.makedirs(os.path.dirname(second))
            for path in (first, second):
                with open(path, "w", encoding="utf-8") as handle:
                    handle.write(
                        json.dumps(
                            {
                                "session_id": "shared",
                                "type": "event_msg",
                                "payload": {
                                    "token_count": {"total_token_usage": {"input_tokens": 1}}
                                },
                            }
                        )
                        + "\n"
                    )
            usage = analytics.LocalJournalUsageProvider(codex_roots=[directory]).usage_for_session(
                "shared", "codex"
            )
            self.assertFalse(usage["observed"])
            self.assertIsNone(usage["tokens"])

    def test_space_usage_marks_cross_space_session_shared(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            os.environ["VALKAMA_DB"] = os.path.join(directory, "valkama.sqlite3")
            journal = os.path.join(directory, "shared.jsonl")
            with open(journal, "w", encoding="utf-8") as handle:
                handle.write(
                    json.dumps(
                        {
                            "session_id": "shared-board",
                            "payload": {
                                "token_count": {
                                    "total_token_usage": {"input_tokens": 4, "output_tokens": 2}
                                }
                            },
                        }
                    )
                    + "\n"
                )
            conn = store.connect()
            try:
                seed_space(conn, "Usage one")
                seed_space(conn, "Usage two")
                first = seed_item(conn, "first", "Usage one")
                second = seed_item(conn, "second", "Usage two")
                attach(conn, first["reference"], "session", "shared-board")
                attach(conn, second["reference"], "session", "shared-board")
                conn.execute(
                    "INSERT INTO sessions(id, client, cwd) VALUES (?,?,?)",
                    ("shared-board", "codex", directory),
                )
                conn.commit()
                provider = analytics.LocalJournalUsageProvider(codex_roots=[directory])
                space_id = conn.execute(
                    "SELECT planning_space_id FROM planning_spaces WHERE key = ?",
                    (key_for("Usage one"),),
                ).fetchone()[0]
                usage = provider.space_usage(conn, space_id)
                self.assertEqual(1, usage["global_linked_sessions"])
                self.assertTrue(usage["sessions"][0]["shared"])
                self.assertEqual(
                    [key_for("Usage one"), key_for("Usage two")],
                    usage["sessions"][0]["planning_spaces"],
                )
            finally:
                conn.close()
                os.environ["VALKAMA_DB"] = SUITE_STORE

    def test_dashboard_uses_null_usage_and_as_of(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            os.environ["VALKAMA_DB"] = os.path.join(directory, "valkama.sqlite3")
            conn = store.connect()
            try:
                seed_space(conn, "Analytics")
                card = seed_item(conn, "one", "Analytics")
                backdate(conn, card["reference"], "2026-01-01T00:00:00Z")
                conn.commit()
                payload = analytics.project_space(
                    conn, key_for("Analytics"), as_of="2026-01-01T01:00:00Z"
                )
                self.assertEqual("2026-01-01T01:00:00Z", payload["as_of"])
                self.assertIsNone(payload["usage"]["totals"])
            finally:
                conn.close()
                os.environ["VALKAMA_DB"] = SUITE_STORE

    def test_dashboard_session_events_keep_linked_and_unlinked_coverage(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            os.environ["VALKAMA_DB"] = os.path.join(directory, "valkama.sqlite3")
            conn = store.connect()
            try:
                seed_space(conn, "Session metrics")
                card = seed_item(conn, "linked", "Session metrics")
                attach(conn, card["reference"], "session", "linked-session")
                sessions.op_ingest_session_event(
                    conn,
                    {
                        "session_id": "linked-session",
                        "client": "codex",
                        "event": "tool_end",
                        "tool": "Read",
                        "server": "files",
                        "status": "ok",
                    },
                )
                sessions.op_ingest_session_event(
                    conn,
                    {
                        "session_id": "global-session",
                        "client": "claude",
                        "event": "tool_end",
                        "tool": "Bash",
                        "server": "shell",
                        "status": "error",
                    },
                )
                payload = analytics.project_space(conn, key_for("Session metrics"))
                metrics = payload["session_analytics"]
                self.assertEqual(2, metrics["events"])
                self.assertEqual(1, metrics["evidence_coverage"]["states"]["linked"])
                self.assertEqual(1, metrics["evidence_coverage"]["states"]["unlinked"])
                self.assertEqual({"name": "Read", "events": 1}, metrics["tools"][0])
            finally:
                conn.close()
                os.environ["VALKAMA_DB"] = SUITE_STORE

    def test_project_scope_honors_time_dimensions_and_unknown_state(self) -> None:
        """One evidence selection must not leak future, other-client, or tool rows."""

        with tempfile.TemporaryDirectory() as directory:
            os.environ["VALKAMA_DB"] = os.path.join(directory, "valkama.sqlite3")
            conn = store.connect()
            try:
                seed_space(conn, "Scoped")
                codex_card = seed_item(conn, "codex", "Scoped")
                claude_card = seed_item(conn, "claude", "Scoped")
                future_card = seed_item(conn, "future", "Scoped")
                for reference, author, stamp in (
                    (codex_card["reference"], "alice", "2026-01-01T00:00:00Z"),
                    (claude_card["reference"], "bob", "2026-01-01T00:00:00Z"),
                    (future_card["reference"], "future", "2026-01-03T00:00:00Z"),
                ):
                    replace_events(conn, reference, (("created", "backlog", author, stamp),))
                for session_id, card_id, client, detail in (
                    (
                        "codex-session",
                        codex_card["reference"],
                        "codex",
                        {"environment": "worktree", "role": "executor"},
                    ),
                    (
                        "claude-session",
                        claude_card["reference"],
                        "claude",
                        {"environment": "workdir", "role": "reviewer"},
                    ),
                ):
                    attach(conn, card_id, "session", session_id)
                    sessions.op_ingest_session_event(
                        conn,
                        {
                            "session_id": session_id,
                            "client": client,
                            "event": "session_start",
                            "detail": detail,
                        },
                    )
                sessions.op_ingest_session_event(
                    conn,
                    {
                        "session_id": "codex-session",
                        "client": "codex",
                        "event": "tool_end",
                        "tool": "Read",
                        "server": "files",
                        "status": "ok",
                    },
                )
                sessions.op_ingest_session_event(
                    conn,
                    {
                        "session_id": "codex-session",
                        "client": "codex",
                        "event": "tool_end",
                        "tool": "Future",
                        "server": "files",
                        "status": "ok",
                    },
                )
                sessions.op_ingest_session_event(
                    conn,
                    {
                        "session_id": "claude-session",
                        "client": "claude",
                        "event": "tool_end",
                        "tool": "Bash",
                        "server": "shell",
                        "status": "error",
                    },
                )
                sessions.op_ingest_session_event(
                    conn,
                    {
                        "session_id": "unlinked-session",
                        "client": "claude",
                        "event": "tool_end",
                        "tool": "Leak",
                        "server": "secret",
                        "status": "ok",
                    },
                )
                conn.execute(
                    "UPDATE session_events SET created_at = CASE"
                    " WHEN session_id = 'codex-session' AND kind = 'session_start' THEN '2026-01-01T01:00:00Z'"
                    " WHEN session_id = 'claude-session' AND kind = 'session_start' THEN '2026-01-01T01:00:00Z'"
                    " WHEN session_id = 'codex-session' AND tool = 'Read' THEN '2026-01-02T01:00:00Z'"
                    " WHEN session_id = 'codex-session' AND tool = 'Future' THEN '2026-01-03T01:00:00Z'"
                    " WHEN session_id = 'claude-session' THEN '2026-01-02T02:00:00Z'"
                    " WHEN session_id = 'unlinked-session' THEN '2026-01-02T03:00:00Z'"
                    " ELSE created_at END"
                )
                conn.commit()
                as_of = "2026-01-02T12:00:00Z"
                payload = analytics.project_space(conn, key_for("Scoped"), as_of=as_of)
                self.assertNotIn(
                    "Future", {row["name"] for row in payload["session_analytics"]["tools"]}
                )
                self.assertNotIn(
                    "Leak", {row["name"] for row in payload["session_analytics"]["tools"]}
                )
                self.assertEqual(1, payload["flow"]["unknown"])
                self.assertEqual(2, payload["flow"]["backlog"])
                self.assertEqual(
                    1, payload["session_analytics"]["evidence_coverage"]["states"]["unlinked"]
                )
                self.assertEqual(
                    {"workdir", "worktree"},
                    {entry["value"] for entry in payload["facets"]["environments"]},
                )
                self.assertEqual(
                    {"Read", "Bash"},
                    {row["tool"] for row in payload["session_analytics"]["tool_usage"]},
                )
                read_usage = next(
                    row
                    for row in payload["session_analytics"]["tool_usage"]
                    if row["tool"] == "Read"
                )
                self.assertEqual("files·Read", read_usage["name"])
                self.assertEqual(1, read_usage["success"])
                worktree_runtime = next(
                    row
                    for row in payload["session_analytics"]["runtime"]
                    if row["name"] == "worktree"
                )
                self.assertEqual(1, worktree_runtime["sessions"])
                self.assertIn(worktree_runtime["coverage"], {"inferred", "partial"})

                codex = analytics.project_space(
                    conn, key_for("Scoped"), as_of=as_of, client="codex"
                )
                self.assertEqual(["codex"], [card["title"] for card in codex["work_items"]])
                self.assertEqual(
                    {"Read"}, {row["tool"] for row in codex["session_analytics"]["tool_usage"]}
                )
                worktree = analytics.project_space(
                    conn, key_for("Scoped"), as_of=as_of, environment="worktree"
                )
                self.assertEqual(["codex"], [card["title"] for card in worktree["work_items"]])
                read = analytics.project_space(conn, key_for("Scoped"), as_of=as_of, tool="Read")
                self.assertEqual(["codex"], [item["title"] for item in read["work_items"]])
                self.assertEqual(1, read["session_analytics"]["tool_usage"][0]["calls"])

                before_tools = analytics.project_space(
                    conn,
                    key_for("Scoped"),
                    as_of=as_of,
                    date_from="2026-01-01T00:00:00Z",
                    date_to="2026-01-02T00:00:00Z",
                )
                self.assertEqual([], before_tools["session_analytics"]["tool_usage"])
                self.assertNotIn(
                    "Future", {row["name"] for row in before_tools["session_analytics"]["tools"]}
                )
            finally:
                conn.close()
                os.environ["VALKAMA_DB"] = SUITE_STORE

    def test_codex_daily_deltas_are_positive_and_reset_is_unknown(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "codex.jsonl")
            rows = [
                {
                    "timestamp": "2026-01-01T00:00:00Z",
                    "payload": {
                        "token_count": {
                            "total_token_usage": {"input_tokens": 2, "output_tokens": 1}
                        }
                    },
                },
                {
                    "timestamp": "2026-01-01T01:00:00Z",
                    "payload": {
                        "token_count": {
                            "total_token_usage": {"input_tokens": 5, "output_tokens": 3}
                        }
                    },
                },
                {
                    "timestamp": "2026-01-02T00:00:00Z",
                    "payload": {
                        "token_count": {
                            "total_token_usage": {"input_tokens": 1, "output_tokens": 1}
                        }
                    },
                },
                {
                    "timestamp": "2026-01-02T01:00:00Z",
                    "payload": {
                        "token_count": {
                            "total_token_usage": {"input_tokens": 4, "output_tokens": 2}
                        }
                    },
                },
                {
                    "timestamp": "2026-01-03T00:00:00Z",
                    "payload": {
                        "token_count": {
                            "total_token_usage": {"input_tokens": 9, "output_tokens": 5}
                        }
                    },
                },
            ]
            with open(path, "w", encoding="utf-8") as handle:
                handle.writelines(json.dumps(row) + "\n" for row in rows)
            usage = analytics.LocalJournalUsageProvider(codex_roots=[path]).usage_for_session(
                "codex", "codex", as_of="2026-01-02T12:00:00Z"
            )
            by_day = {row["date"]: row for row in usage["daily"]}
            self.assertEqual(
                {"input_tokens": 3, "output_tokens": 2}, by_day["2026-01-01"]["tokens"]
            )
            self.assertTrue(by_day["2026-01-01"]["unknown"])
            self.assertTrue(by_day["2026-01-02"]["unknown"])
            self.assertNotIn("2026-01-03", by_day)
            self.assertTrue(usage["daily_unknown"])

    def test_claude_daily_series_dedupes_message_ids_and_marks_cost_unknown(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "claude.jsonl")
            rows = [
                {
                    "timestamp": "2026-01-01T00:00:00Z",
                    "type": "assistant",
                    "message": {"id": "m1", "model": "x", "usage": {"input_tokens": 2}},
                    "cost_usd": 1,
                },
                {
                    "timestamp": "2026-01-01T00:01:00Z",
                    "type": "assistant",
                    "message": {"id": "m1", "model": "x", "usage": {"input_tokens": 4}},
                    "cost_usd": 2,
                },
                {
                    "timestamp": "2026-01-02T00:00:00Z",
                    "type": "assistant",
                    "message": {"id": "m2", "model": "x", "usage": {"input_tokens": 3}},
                    "cost_usd": 3,
                },
            ]
            with open(path, "w", encoding="utf-8") as handle:
                handle.writelines(json.dumps(row) + "\n" for row in rows)
            usage = analytics.LocalJournalUsageProvider(claude_roots=[path]).usage_for_session(
                "claude", "claude"
            )
            self.assertEqual(7, usage["tokens"]["input_tokens"])
            self.assertIsNone(usage["cost"])
            self.assertTrue({row["date"]: row for row in usage["daily"]}["2026-01-01"]["unknown"])

    def test_repeated_identity_projection_does_not_rescan_jsonl(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "journal.jsonl")
            self._write_codex_journal(path, "session-one")
            provider = analytics.LocalJournalUsageProvider(codex_roots=[directory])
            original = analytics.LocalJournalUsageProvider._identity_values_uncached
            calls: list[str] = []

            def counted(cls, candidate: pathlib.Path):
                calls.append(str(candidate))
                return original.__func__(cls, candidate)

            with mock.patch.object(
                analytics.LocalJournalUsageProvider,
                "_identity_values_uncached",
                classmethod(counted),
            ):
                first = provider.usage_for_session("session-one", "codex")
                second = provider.usage_for_session("session-one", "codex")
            self.assertTrue(first["observed"])
            self.assertEqual(first["tokens"], second["tokens"])
            self.assertEqual(1, len(calls))

    def test_one_journal_stat_change_invalidates_only_that_identity_record(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            first_path = os.path.join(directory, "first.jsonl")
            second_path = os.path.join(directory, "second.jsonl")
            self._write_codex_journal(first_path, "session-one")
            self._write_codex_journal(second_path, "session-two")
            provider = analytics.LocalJournalUsageProvider(codex_roots=[directory])
            original = analytics.LocalJournalUsageProvider._identity_values_uncached
            calls: list[str] = []

            def counted(cls, candidate: pathlib.Path):
                calls.append(str(candidate))
                return original.__func__(cls, candidate)

            with mock.patch.object(
                analytics.LocalJournalUsageProvider,
                "_identity_values_uncached",
                classmethod(counted),
            ):
                provider.usage_for_session("session-one", "codex")
                provider.usage_for_session("session-two", "codex")
                calls.clear()
                with open(first_path, "a", encoding="utf-8") as handle:
                    handle.write("{}\n")
                os.utime(first_path, ns=(time.time_ns(), time.time_ns()))
                fresh_provider = analytics.LocalJournalUsageProvider(codex_roots=[directory])
                fresh_provider.usage_for_session("session-one", "codex")
                fresh_provider.usage_for_session("session-two", "codex")
            self.assertEqual([os.path.realpath(first_path)], calls)

    def test_warm_real_shaped_projection_is_fast_and_does_not_reopen_journals(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            os.environ["VALKAMA_DB"] = os.path.join(directory, "valkama.sqlite3")
            journal_root = os.path.join(directory, "journals")
            os.makedirs(journal_root)
            conn = store.connect()
            try:
                seed_space(conn, "Warm")
                for index in range(24):
                    session_id = f"session-{index}"
                    card = seed_item(conn, f"card-{index}", "Warm")
                    attach(conn, card["reference"], "session", session_id)
                    conn.execute(
                        "INSERT INTO sessions(id, client, cwd) VALUES (?,?,?)",
                        (session_id, "codex", journal_root),
                    )
                    self._write_codex_journal(
                        os.path.join(journal_root, f"journal-{index}.jsonl"), session_id, index + 2
                    )
                conn.commit()
                first_provider = analytics.LocalJournalUsageProvider(codex_roots=[journal_root])
                analytics.project_space(
                    conn,
                    key_for("Warm"),
                    as_of="2026-01-02T00:00:00Z",
                    usage_provider=first_provider,
                )
                second_provider = analytics.LocalJournalUsageProvider(codex_roots=[journal_root])
                original_identity = analytics.LocalJournalUsageProvider._identity_values_uncached
                original_parser = analytics.LocalJournalUsageProvider._codex_usage
                identity_calls: list[str] = []
                parser_calls: list[str] = []

                def counted_identity(cls, candidate: pathlib.Path):
                    identity_calls.append(str(candidate))
                    return original_identity.__func__(cls, candidate)

                def counted_parser(cls, candidate: pathlib.Path, **kwargs):
                    parser_calls.append(str(candidate))
                    return original_parser.__func__(cls, candidate, **kwargs)

                real_rglob = pathlib.Path.rglob
                real_open = pathlib.Path.open

                with (
                    mock.patch.object(
                        analytics.LocalJournalUsageProvider,
                        "_identity_values_uncached",
                        classmethod(counted_identity),
                    ),
                    mock.patch.object(
                        analytics.LocalJournalUsageProvider,
                        "_codex_usage",
                        classmethod(counted_parser),
                    ),
                    mock.patch.object(
                        pathlib.Path,
                        "rglob",
                        autospec=True,
                        side_effect=lambda self, *args, **kwargs: real_rglob(self, *args, **kwargs),
                    ) as rglob,
                    mock.patch.object(
                        pathlib.Path,
                        "open",
                        autospec=True,
                        side_effect=lambda self, *args, **kwargs: real_open(self, *args, **kwargs),
                    ) as opened,
                ):
                    started = time.perf_counter()
                    payload = analytics.project_space(
                        conn,
                        key_for("Warm"),
                        as_of="2026-01-02T00:00:00Z",
                        usage_provider=second_provider,
                    )
                    # A direct usage lookup proves journal parsing is shared
                    # even when a provider is freshly constructed.
                    second_provider.usage_for_session(
                        "session-0", "codex", as_of="2026-01-02T00:00:00Z"
                    )
                    elapsed = time.perf_counter() - started
                self.assertEqual(24, payload["usage"]["linked_sessions"])
                self.assertLessEqual(elapsed, 0.150)
                self.assertEqual(0, rglob.call_count)
                self.assertEqual([], identity_calls)
                self.assertEqual([], parser_calls)
                self.assertEqual(0, opened.call_count)
            finally:
                conn.close()
                os.environ["VALKAMA_DB"] = SUITE_STORE

    def test_nested_journal_changes_invalidate_index_without_rescanning_unrelated_roots(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory) / "journals"
            nested = root / "nested"
            nested.mkdir(parents=True)
            first_path = nested / "first.jsonl"
            self._write_codex_journal(str(first_path), "session-one")
            provider = analytics.LocalJournalUsageProvider(codex_roots=[str(root)])
            self.assertTrue(provider.usage_for_session("session-one", "codex")["observed"])

            second_path = nested / "second.jsonl"
            self._write_codex_journal(str(second_path), "session-two")
            self.assertTrue(provider.usage_for_session("session-two", "codex")["observed"])

            first_path.unlink()
            self.assertFalse(provider.usage_for_session("session-one", "codex")["observed"])

    def test_fresh_provider_discovers_a_direct_journal_root_created_after_empty_index(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            journal = pathlib.Path(directory) / "late-session.jsonl"
            first = analytics.LocalJournalUsageProvider(codex_roots=[str(journal)])
            self.assertFalse(first.usage_for_session("late-session", "codex")["observed"])

            self._write_codex_journal(str(journal), "late-session")
            fresh = analytics.LocalJournalUsageProvider(codex_roots=[str(journal)])
            self.assertTrue(fresh.usage_for_session("late-session", "codex")["observed"])

    def test_process_caches_have_bounded_deterministic_eviction(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            original_limit = analytics._CACHE.MAX_INDEXES
            analytics.clear_analytics_cache()
            try:
                analytics._CACHE.MAX_INDEXES = 2
                roots = []
                for index in range(3):
                    root = pathlib.Path(directory) / f"root-{index}"
                    root.mkdir()
                    roots.append(str(root))
                    analytics.LocalJournalUsageProvider(codex_roots=[str(root)])._index("codex")
                self.assertEqual(2, len(analytics._CACHE.indexes))
                self.assertEqual(
                    ("codex", (os.path.realpath(roots[1]),)), next(iter(analytics._CACHE.indexes))
                )
            finally:
                analytics._CACHE.MAX_INDEXES = original_limit
                analytics.clear_analytics_cache()

    def test_projection_cache_does_not_collide_when_database_file_is_replaced(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            db_path = os.path.join(directory, "valkama.sqlite3")
            os.environ["VALKAMA_DB"] = db_path
            second_conn = None
            try:
                first_conn = store.connect()
                seed_space(first_conn, "Snapshot")
                seed_item(first_conn, "first", "Snapshot")
                first = analytics.project_space(
                    first_conn, key_for("Snapshot"), as_of="2099-01-01T00:00:00Z"
                )
                first_conn.close()
                for suffix in ("", "-wal", "-shm"):
                    candidate = db_path + suffix
                    if os.path.exists(candidate):
                        os.unlink(candidate)

                second_conn = store.connect()
                seed_space(second_conn, "Snapshot")
                seed_item(second_conn, "second", "Snapshot")
                second = analytics.project_space(
                    second_conn, key_for("Snapshot"), as_of="2099-01-01T00:00:00Z"
                )
                self.assertEqual("first", first["work_items"][0]["title"])
                self.assertEqual("second", second["work_items"][0]["title"])
            finally:
                if second_conn is not None:
                    second_conn.close()
                os.environ["VALKAMA_DB"] = SUITE_STORE

    def test_dashboard_splits_history_and_evidence_coverage(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            os.environ["VALKAMA_DB"] = os.path.join(directory, "valkama.sqlite3")
            conn = store.connect()
            try:
                seed_space(conn, "Dashboard")
                card = seed_item(conn, "linked", "Dashboard")
                attach(conn, card["reference"], "session", "linked-session")
                sessions.op_ingest_session_event(
                    conn,
                    {
                        "session_id": "linked-session",
                        "client": "codex",
                        "event": "tool_end",
                        "tool": "Read",
                        "server": "files",
                        "status": "ok",
                    },
                )
                sessions.op_ingest_session_event(
                    conn,
                    {
                        "session_id": "unlinked-session",
                        "client": "claude",
                        "event": "tool_end",
                        "tool": "Bash",
                        "server": "shell",
                        "status": "error",
                    },
                )
                payload = analytics.project_space(
                    conn, key_for("Dashboard"), as_of="2099-01-02T00:00:00Z"
                )
                self.assertEqual("dashboard", payload["interface_version"])
                self.assertNotIn("coverage", payload)
                self.assertIn("history_coverage", payload)
                self.assertIn("evidence_coverage", payload)
                self.assertEqual(1, payload["evidence_coverage"]["states"]["linked"])
                self.assertEqual(1, payload["evidence_coverage"]["states"]["unlinked"])
                self.assertEqual(
                    {
                        "overall": "partial",
                        "states": {"linked": 1, "other_space": 0, "unlinked": 1},
                        "events": 2,
                        "as_of": "2099-01-02T00:00:00Z",
                    },
                    payload["session_analytics"]["evidence_coverage"],
                )
            finally:
                conn.close()
                os.environ["VALKAMA_DB"] = SUITE_STORE

    def test_flow_and_inventory_share_the_same_non_epic_card_population(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            os.environ["VALKAMA_DB"] = os.path.join(directory, "valkama.sqlite3")
            conn = store.connect()
            try:
                seed_space(conn, "Consistent flow")
                epic = seed_item(conn, "Epic", "Consistent flow")
                seed_item(conn, "Child", "Consistent flow", parent=epic["reference"])

                payload = analytics.project_space(
                    conn,
                    key_for("Consistent flow"),
                    as_of="2099-01-02T00:00:00Z",
                )

                self.assertEqual(1, payload["kpis"]["inventory"])
                self.assertEqual(1, sum(payload["flow"].values()))
                self.assertEqual(1, payload["flow"]["backlog"])
            finally:
                conn.close()
                os.environ["VALKAMA_DB"] = SUITE_STORE

    def test_dashboard_uses_claim_ref_everywhere_and_never_republishes_claimed_by(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            os.environ["VALKAMA_DB"] = os.path.join(directory, "valkama.sqlite3")
            conn = store.connect()
            try:
                seed_space(conn, "Claims")
                item = seed_item(conn, "owned", "Claims")
                planning_service.claim_work_item(conn, item["reference"], author="codex")
                conn.commit()

                payload = analytics.project_space(
                    conn,
                    key_for("Claims"),
                    as_of="2099-01-02T00:00:00Z",
                    agent="codex",
                )

                self.assertEqual(1, len(payload["work_items"]))
                self.assertEqual("codex", payload["work_items"][0]["claim_ref"])
                self.assertNotIn("claimed_by", payload["work_items"][0])
            finally:
                conn.close()
                os.environ["VALKAMA_DB"] = SUITE_STORE

    def test_dashboard_filter_echo_is_one_canonical_contract(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            os.environ["VALKAMA_DB"] = os.path.join(directory, "valkama.sqlite3")
            conn = store.connect()
            try:
                seed_space(conn, "Canonical filters")
                payload = http_surface.dashboard_projection(
                    conn,
                    {
                        "space": [key_for("Canonical filters")],
                        "as_of": ["2026-08-24T12:00:00Z"],
                        "date_from": ["2026-08-01T00:00:00Z"],
                        "date_to": ["2026-08-24T00:00:00Z"],
                    },
                )

                self.assertEqual(
                    {
                        "epic": None,
                        "client": None,
                        "agent": None,
                        "environment": None,
                        "tool": None,
                        "status": None,
                        "date_from": "2026-08-01T00:00:00Z",
                        "date_to": "2026-08-24T00:00:00Z",
                        "as_of": "2026-08-24T12:00:00Z",
                    },
                    payload["filters"],
                )
                with self.assertRaisesRegex(ValueError, "date_from"):
                    http_surface.dashboard_projection(
                        conn,
                        {"space": [key_for("Canonical filters")], "from": ["2026-08-01"]},
                    )
                with self.assertRaisesRegex(ValueError, "date_to"):
                    http_surface._dashboard_sse_parameters(
                        key_for("Canonical filters"), {"to": ["2026-08-24"]}
                    )
            finally:
                conn.close()
                os.environ["VALKAMA_DB"] = SUITE_STORE


class ExecutionAnalyticsTests(unittest.TestCase):
    """What the attempts in a space add up to, and how confident that total is."""

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        os.environ["VALKAMA_DB"] = os.path.join(self._dir.name, "test.sqlite3")
        self.addCleanup(lambda: os.environ.__setitem__("VALKAMA_DB", SUITE_STORE))
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.space = planning.create_planning_space(
            self.conn, project_id="test", name="Test", key="TST"
        )
        self.conn.commit()

    def attempt(self, *, status: str = "complete", started: str = "", ended: str = "") -> str:
        record = planning.create_work_item(self.conn, space="TST", title="attempted", state="todo")
        self.conn.commit()
        execution_id = execution_service.new_execution_id()
        execution_service.open_execution(
            self.conn,
            execution_id=execution_id,
            work_item_id=str(record["work_item_id"]),
            project_id="test",
            packet={
                "client": "claude",
                "role": "executor",
                "environment": "workdir",
                "expected_effect": "change_required",
                "model": "opus",
            },
        )
        if started:
            self.conn.execute(
                "UPDATE executions SET started_at = ? WHERE execution_id = ?",
                (started, execution_id),
            )
        if status not in ("starting", "running"):
            self.conn.execute(
                "UPDATE executions SET status = ?, ended_at = ? WHERE execution_id = ?",
                (status, ended or started or "2026-08-20T00:10:00Z", execution_id),
            )
        else:
            self.conn.execute(
                "UPDATE executions SET status = ? WHERE execution_id = ?", (status, execution_id)
            )
        self.conn.commit()
        return execution_id

    def aggregate(self, **kwargs) -> dict:
        return execution_analytics.space_executions(
            self.conn, str(self.space["planning_space_id"]), **kwargs
        )

    def test_a_space_with_no_attempts_says_so_without_pretending_to_measure(self) -> None:
        answer = self.aggregate()
        self.assertEqual(0, answer["attempts"])
        self.assertEqual("unknown", answer["tokens_coverage"])
        self.assertEqual("unknown", answer["execution_wall_time"]["coverage"])
        self.assertIsNone(answer["execution_wall_time"]["seconds"])
        for field in answer["tokens"].values():
            self.assertIsNone(field["value"])

    def test_the_rows_behind_the_totals_are_listed_newest_first(self) -> None:
        """An aggregate a reader cannot open is one they can only trust.

        The coverage line says how much of the total was observed; it cannot
        say which attempt is missing, and that is the question somebody opens
        a drill-down to answer.
        """

        self.attempt(status="complete", started="2026-08-20T00:00:00Z")
        self.attempt(status="failed", started="2026-08-20T01:00:00Z")
        answer = self.aggregate()

        self.assertFalse(answer["attempt_rows_truncated"])
        rows = answer["attempt_rows"]
        self.assertEqual(answer["attempts"], len(rows))
        self.assertEqual(["failed", "complete"], [row["status"] for row in rows])
        self.assertEqual(["TST-2", "TST-1"], [row["work_item"] for row in rows])
        for row in rows:
            self.assertEqual("claude", row["client_family"])
            self.assertEqual("opus", row["model"])
            self.assertEqual("executor", row["role"])

    def test_a_row_carries_its_own_quality_rather_than_the_block_coverage(self) -> None:
        # A space that is half observed says `partial` once at the top. The row
        # is where a reader finds out which half this attempt is in.
        self.attempt(status="complete", started="2026-08-20T00:00:00Z")
        (row,) = self.aggregate()["attempt_rows"]
        self.assertIsNone(row["tokens"])
        self.assertEqual("unknown", row["tokens_quality"])
        self.assertEqual("unknown", row["source"]["quality"])
        self.assertEqual("", row["source"]["adapter_id"])
        # Nothing was linked, so there is no trace to point at — and an empty
        # list says that, where an absent field would not.
        self.assertEqual([], row["sessions"])

    def test_a_wall_time_is_measured_only_when_the_attempt_ended(self) -> None:
        self.attempt(status="running", started="2026-08-20T00:00:00Z")
        self.attempt(
            status="complete", started="2026-08-20T01:00:00Z", ended="2026-08-20T01:02:30Z"
        )
        rows = {row["status"]: row for row in self.aggregate()["attempt_rows"]}
        self.assertEqual(150, rows["complete"]["wall_seconds"])
        self.assertIsNone(rows["running"]["wall_seconds"])
        self.assertEqual("", rows["running"]["ended_at"])

    def test_an_unread_checkout_and_an_empty_diff_are_different_answers(self) -> None:
        """Absent is not zero, which is the rule the whole block is built on."""

        first = self.attempt(status="complete", started="2026-08-20T00:00:00Z")
        second = self.attempt(status="complete", started="2026-08-20T01:00:00Z")
        self.conn.execute(
            "UPDATE executions SET final_artifact_json = ? WHERE execution_id = ?",
            ('{"changed_files": 0, "quality": "observed"}', first),
        )
        self.conn.execute(
            "UPDATE executions SET final_artifact_json = ? WHERE execution_id = ?",
            ("not json at all", second),
        )
        self.conn.commit()
        rows = {row["execution_id"]: row for row in self.aggregate()["attempt_rows"]}
        self.assertEqual(0, rows[first]["changed_files"])
        self.assertIsNone(rows[second]["changed_files"])

    def test_the_list_is_bounded_below_the_aggregation_and_says_when_it_cut(self) -> None:
        """The totals describe the space; the list is read, not exported.

        Both bounds are stated separately because they answer different
        questions, and a list silently shorter than the count it sits under is
        the failure the `truncated` flags exist to prevent.
        """

        for index in range(execution_analytics.MAX_ATTEMPT_DETAIL + 2):
            self.attempt(status="complete", started=f"2026-08-20T00:{index % 60:02d}:00Z")
        answer = self.aggregate()
        self.assertEqual(execution_analytics.MAX_ATTEMPT_DETAIL + 2, answer["attempts"])
        self.assertFalse(answer["truncated"])
        self.assertEqual(execution_analytics.MAX_ATTEMPT_DETAIL, len(answer["attempt_rows"]))
        self.assertTrue(answer["attempt_rows_truncated"])

    def test_a_running_attempt_is_counted_but_has_not_ended(self) -> None:
        self.attempt(status="complete", started="2026-08-20T00:00:00Z")
        self.attempt(status="running", started="2026-08-20T01:00:00Z")
        answer = self.aggregate()

        self.assertEqual(2, answer["attempts"])
        # A rate over attempts that have not finished moves every time somebody
        # starts work, so the denominator is the ones that ended.
        self.assertEqual(1, answer["ended"])
        self.assertEqual(1, answer["delivered"])
        self.assertEqual(
            {"complete": 1, "running": 1},
            {entry["name"]: entry["attempts"] for entry in answer["statuses"]},
        )
        # And the wall time is partial for the same reason, rather than silently
        # averaging over one of two.
        self.assertEqual("partial", answer["execution_wall_time"]["coverage"])

    def test_active_time_is_never_derived_from_wall_time(self) -> None:
        self.attempt(started="2026-08-20T00:00:00Z", ended="2026-08-20T00:05:00Z")
        answer = self.aggregate()
        self.assertEqual(300, answer["execution_wall_time"]["seconds"])
        # A journal cannot tell an idle hour from a working one, so this stays
        # unknown until a source that measures it is connected.
        self.assertIsNone(answer["execution_active_time"]["seconds"])
        self.assertEqual("unknown", answer["execution_active_time"]["coverage"])

    def test_an_unobserved_attempt_lowers_confidence_without_lowering_the_count(self) -> None:
        self.attempt(started="2026-08-20T00:00:00Z")
        self.attempt(started="2026-08-20T02:00:00Z")
        answer = self.aggregate()
        # Neither attempt has a journal here, so the tokens are unknown while
        # the attempts themselves are perfectly well counted.
        self.assertEqual(2, answer["attempts"])
        self.assertEqual(0, answer["observed_attempts"])
        self.assertEqual("unknown", answer["tokens_coverage"])
        self.assertIsNone(answer["tokens"]["input"]["value"])

    def test_the_window_filters_on_when_an_attempt_was_made(self) -> None:
        self.attempt(started="2026-08-01T00:00:00Z")
        self.attempt(started="2026-08-20T00:00:00Z")
        answer = self.aggregate(start="2026-08-10T00:00:00Z")
        self.assertEqual(1, answer["attempts"])
        self.assertEqual(1, self.aggregate(finish="2026-08-10T00:00:00Z")["attempts"])

    def test_truncation_is_reported_rather_than_silent(self) -> None:
        for index in range(3):
            self.attempt(started=f"2026-08-2{index}T00:00:00Z")
        answer = self.aggregate(limit=2)
        self.assertEqual(2, answer["attempts"])
        self.assertTrue(answer["truncated"], "a page presented as the whole is the defect")
        self.assertFalse(self.aggregate()["truncated"])

    def test_the_dashboard_payload_carries_the_attempts(self) -> None:
        self.attempt(started="2026-08-20T00:00:00Z")
        payload = projection.project_space(self.conn, "TST")
        self.assertEqual(1, payload["executions"]["attempts"])
        self.assertEqual(
            [{"name": "claude", "attempts": 1}],
            payload["executions"]["clients"],
        )


class DashboardExportTests(unittest.TestCase):
    """What leaves in the file, and what leaves with it."""

    PAYLOAD: ClassVar[dict] = {
        "kpis": {
            "inventory": 12,
            "completed": 4,
            "blocked": 1,
            "reopened": 0,
            "cycle_seconds": None,
        },
        "history_coverage": {"overall": "partial"},
        "executions": {
            "attempts": 3,
            "ended": 2,
            "delivered": 1,
            "execution_wall_time": {"seconds": 900, "coverage": "partial"},
            "execution_active_time": {"seconds": None, "coverage": "unknown"},
            "tokens": {
                "input": {"value": 100, "quality": "observed"},
                "total": {"value": None, "quality": "unknown"},
            },
            "tokens_coverage": "partial",
            "tools": [{"name": "Read", "server": "", "calls": 9, "errors": 2}],
        },
    }

    def rows(self) -> list[list[str]]:
        text = analytics_export.dashboard_csv(self.PAYLOAD)
        return [line.split(",") for line in text.strip().splitlines()]

    def test_every_row_carries_the_coverage_of_its_number(self) -> None:
        header, *rows = self.rows()
        self.assertEqual(list(analytics_export.COLUMNS), header)
        # A CSV is read without its context more often than any other format, so
        # a figure that leaves without its coverage is one a reader treats as
        # exact.
        for row in rows:
            self.assertEqual(len(analytics_export.COLUMNS), len(row))
            self.assertIn(row[-1], ("confirmed", "partial", "unknown"))

    def test_an_unobserved_value_is_an_empty_cell_and_never_a_zero(self) -> None:
        by_metric = {row[1]: row for row in self.rows()[1:]}
        self.assertEqual("", by_metric["planning_cycle_time"][2])
        self.assertEqual("", by_metric["execution_active_time"][2])
        self.assertEqual("", by_metric["total"][2], "a spreadsheet sums a zero")
        self.assertEqual("100", by_metric["input"][2])

    def test_the_export_route_is_owned_and_dispatched(self) -> None:
        """A handler nobody routes to answers 404, and layer 1 shipped one.

        The module gate and the dispatch are two lists that have to agree, and
        an endpoint missing from either is refused silently — which is exactly
        how the Kernel work-item read spent a layer unreachable.
        """

        self.assertEqual(
            "analytics",
            http_surface._HTTP_ROUTE_MODULES[("GET", "/api/dashboard/export")],
        )
        source = inspect.getsource(http_surface)
        self.assertIn('url.path == "/api/dashboard/export"', source)
        self.assertIn("analytics_export.dashboard_csv", source)

    def test_a_failing_tool_is_exported_as_its_own_row(self) -> None:
        by_metric = {row[1]: row for row in self.rows()[1:]}
        self.assertEqual("9", by_metric["Read"][2])
        self.assertEqual("2", by_metric["Read errors"][2])


class PortfolioAnalyticsTests(unittest.TestCase):
    """Several projects in one reading, and what may not be added.

    The rules are §14.4 applied one level up: counts add, coverage is
    recomputed rather than averaged, and a mean is weighted by how many
    observations it came from.
    """

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        os.environ["VALKAMA_DB"] = os.path.join(self._dir.name, "portfolio.sqlite3")
        self.addCleanup(lambda: os.environ.__setitem__("VALKAMA_DB", SUITE_STORE))
        self.conn = store.connect()
        self.addCleanup(self.conn.close)

    def space(self, key: str, project: str) -> dict:
        record = planning.create_planning_space(self.conn, project_id=project, name=key, key=key)
        self.conn.commit()
        return record

    def closed_item(self, space: str, *, opened: str, closed: str) -> None:
        """A work item with a measured cycle, so a mean has something to weigh.

        Through `dev` on the way, because a cycle is measured from the first
        active segment: an item that goes straight from queued to completed was
        never worked on as far as the timeline can tell.
        """

        record = planning.create_work_item(self.conn, space=space, title="done", state="todo")
        item = str(record["work_item_id"])
        for state, stamp in (("dev", opened), ("done", closed)):
            planning.transition_work_item(self.conn, item, state, author="tester", force=True)
            # The transition, named exactly: a forced move writes an
            # `overridden` event after it, and stamping the last row would
            # date the override instead of the move.
            self.conn.execute(
                "UPDATE work_item_events SET created_at = ?"
                " WHERE work_item_id = ? AND action = 'transitioned' AND detail = ?",
                (stamp, item, state),
            )
        self.conn.commit()

    def test_every_space_in_this_store_is_a_row_and_the_rows_add_up(self) -> None:
        self.space("AAA", "alpha")
        self.space("BBB", "beta")
        planning.create_work_item(self.conn, space="AAA", title="one", state="todo")
        planning.create_work_item(self.conn, space="AAA", title="two", state="todo")
        planning.create_work_item(self.conn, space="BBB", title="three", state="todo")
        self.conn.commit()

        answer = analytics_portfolio.portfolio(self.conn)
        self.assertFalse(answer["truncated"])
        self.assertEqual(["AAA", "BBB"], [row["space_key"] for row in answer["projects"]])
        self.assertEqual(["alpha", "beta"], [row["project_id"] for row in answer["projects"]])
        self.assertEqual(2, answer["totals"]["projects"])
        self.assertEqual(3, answer["totals"]["inventory"])

    def test_coverage_is_recomputed_across_attempts_and_never_averaged(self) -> None:
        """Two `partial` projects are not a `partial` portfolio.

        Merging the per-project verdicts would let one fully-observed project
        lift an unobserved one, which is the failure the coverage line exists
        to prevent — one level up from where it was first prevented.
        """

        self.space("AAA", "alpha")
        answer = analytics_portfolio.portfolio(self.conn)
        # Nothing attempted anywhere: `unknown`, not `confirmed`. An empty total
        # is tidy and has not been measured.
        self.assertEqual("unknown", answer["totals"]["tokens_coverage"])
        self.assertEqual("unknown", answer["totals"]["wall_coverage"])
        self.assertEqual(0, answer["totals"]["attempts"])
        self.assertIsNone(answer["totals"]["tokens"])

    def test_a_cycle_mean_is_weighted_by_the_observations_behind_it(self) -> None:
        """Averaging the averages would let two items outweigh two hundred."""

        self.space("AAA", "alpha")
        self.space("BBB", "beta")
        # One project with a single long cycle, one with three short ones.
        self.closed_item("AAA", opened="2026-08-01T00:00:00Z", closed="2026-08-01T10:00:00Z")
        for _ in range(3):
            self.closed_item("BBB", opened="2026-08-01T00:00:00Z", closed="2026-08-01T02:00:00Z")

        answer = analytics_portfolio.portfolio(self.conn)
        rows = {row["space_key"]: row for row in answer["projects"]}
        self.assertEqual(1, rows["AAA"]["cycle_observed"])
        self.assertEqual(3, rows["BBB"]["cycle_observed"])
        totals = answer["totals"]
        self.assertEqual(4, totals["cycle_observed"])
        expected = round((rows["AAA"]["cycle_seconds"] * 1 + rows["BBB"]["cycle_seconds"] * 3) / 4)
        self.assertEqual(expected, totals["cycle_seconds"])
        # The unweighted mean is a different number, which is the point.
        self.assertNotEqual(
            round((rows["AAA"]["cycle_seconds"] + rows["BBB"]["cycle_seconds"]) / 2),
            totals["cycle_seconds"],
        )

    def test_a_space_is_resolved_by_its_key_and_not_by_its_name(self) -> None:
        """The live store is where this failed, because a fixture hid it.

        A space's name and its key are different strings — "Quality Assurance" is
        keyed `QA` — and the projection resolves by key. Every case here had
        named a space after its own key, so passing the name looked correct
        until it met a real store and raised on the first project.
        """

        planning.create_planning_space(
            self.conn, project_id="alpha", name="Quality Assurance", key="QA"
        )
        planning.create_work_item(self.conn, space="QA", title="one", state="todo")
        self.conn.commit()

        (row,) = analytics_portfolio.portfolio(self.conn)["projects"]
        self.assertEqual("QA", row["space_key"])
        self.assertEqual("Quality Assurance", row["space_name"])
        self.assertEqual(1, row["inventory"])

    def test_a_store_with_no_spaces_reads_as_empty_rather_than_failing(self) -> None:
        answer = analytics_portfolio.portfolio(self.conn)
        self.assertEqual([], answer["projects"])
        self.assertEqual(0, answer["totals"]["projects"])
        self.assertIsNone(answer["totals"]["cycle_seconds"])
        self.assertEqual([], answer["totals"]["adapters"])

    def test_the_reading_is_bounded_and_says_when_it_cut(self) -> None:
        for index in range(analytics_portfolio.MAX_SPACES + 1):
            self.space(f"S{index:02d}", f"project-{index:02d}")
        answer = analytics_portfolio.portfolio(self.conn)
        self.assertEqual(analytics_portfolio.MAX_SPACES, len(answer["projects"]))
        self.assertTrue(answer["truncated"])


if __name__ == "__main__":
    unittest.main()
