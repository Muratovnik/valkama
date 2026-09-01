"""The agent-facing vocabulary of Improvements: one tool per operation.

The same shape Planning uses in `planning/tools.py`, and for the same reason:
a module publishes its own tools, so a schema and the handler behind it are read
and changed together. These definitions lived in the MCP surface, where the
protocol loop had two hundred lines of another module's vocabulary in front of
it and a schema change meant editing a surface.

Declarative on purpose: the definitions are data and every handler is one call
to the same runtime boundary the HTTP surface uses. The surface decides what to
publish; nothing here knows a catalogue exists.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable

from .. import watchers
from ..store import db_path
from . import api as improvements_api
from . import improvements_integration

READ_ONLY = {"readOnlyHint": True, "idempotentHint": True, "openWorldHint": False}
WRITES = {"readOnlyHint": False, "destructiveHint": False, "openWorldHint": False}

_STR = {"type": "string"}
_INT = {"type": "integer"}

TOOLS = [
    {
        "name": "get_improvements_profile",
        "title": "Read Improvements profile",
        "annotations": dict(READ_ONLY, title="Read Improvements profile"),
        "description": "Read one existing scope's Improvements profile without creating its sidecar.",
        "inputSchema": {
            "type": "object",
            "properties": {"scope": _STR},
            "required": ["scope"],
        },
    },
    {
        "name": "record_improvement_signal",
        "title": "Record sanitized Improvements signals",
        "annotations": dict(
            WRITES, idempotentHint=True, title="Record sanitized Improvements signals"
        ),
        "description": "Record one bounded, allowlisted signal packet after external evidence retrieval.",
        "inputSchema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "scope": _STR,
                "signals": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 100,
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "source_kind": {
                                "type": "string",
                                "enum": ["session_event", "agentmemory_lesson", "user_feedback"],
                            },
                            "pointer": {"type": "string", "maxLength": 500},
                            "category": {
                                "type": "string",
                                "enum": list(improvements_integration.ALLOWED_TARGETS),
                            },
                            "severity": {
                                "type": "string",
                                "enum": ["low", "medium", "high", "critical"],
                            },
                            "excerpt": {"type": "string", "minLength": 1, "maxLength": 1200},
                            "at": {"type": "string", "maxLength": 64},
                            "client": {"type": "string", "maxLength": 20},
                            "event_type": {"type": "string", "maxLength": 100},
                            "session_id": {"type": "string", "maxLength": 200},
                        },
                        "required": ["source_kind", "pointer", "category", "severity", "excerpt"],
                    },
                },
            },
            "required": ["scope", "signals"],
        },
    },
    {
        "name": "list_improvement_cases",
        "title": "List Improvements cases",
        "annotations": dict(READ_ONLY, title="List Improvements cases"),
        "description": "List bounded case summaries for exactly one existing scope.",
        "inputSchema": {
            "type": "object",
            "properties": {"scope": _STR, "state": _STR, "limit": _INT},
            "required": ["scope"],
        },
    },
    {
        "name": "get_improvement_case",
        "title": "Read Improvements case",
        "annotations": dict(READ_ONLY, title="Read Improvements case"),
        "description": "Read one case and its redacted evidence, proposal, eval and monitoring state.",
        "inputSchema": {
            "type": "object",
            "properties": {"scope": _STR, "case_id": _INT},
            "required": ["scope", "case_id"],
        },
    },
    {
        "name": "update_improvements_profile",
        "title": "Update Improvements profile",
        "annotations": dict(WRITES, idempotentHint=True, title="Update Improvements profile"),
        "description": "Enable, disable or revise an Improvements profile with optimistic revision control.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "scope": _STR,
                "expected_revision": _INT,
                "enabled": {"type": "boolean"},
                "purpose": _STR,
                "expected_behavior": _STR,
                "allowed_targets": {"type": "array", "items": _STR},
                "excluded_targets": {"type": "array", "items": _STR},
                "analyzer_client": {"type": "string", "enum": ["codex", "claude"]},
                "analyzer_model": {"type": "string", "maxLength": 120},
                "reasoning_effort": {
                    "type": "string",
                    "enum": ["", "low", "medium", "high", "xhigh", "max"],
                },
                "planning_space": _STR,
                "schedule": {"type": "object"},
                "limits": {"type": "object"},
            },
            "required": ["scope", "expected_revision"],
        },
    },
    {
        "name": "analyze_improvements",
        "title": "Analyze Improvements signals",
        "annotations": dict(WRITES, title="Analyze Improvements signals"),
        "description": "Queue one bounded analyzer job for an explicitly enabled scope; never launches a card.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "scope": _STR,
                "trigger": {"type": "string", "enum": ["manual", "scheduled"]},
            },
            "required": ["scope"],
        },
    },
    {
        "name": "improvements_cancel_job",
        "title": "Cancel Improvements job",
        "annotations": dict(WRITES, idempotentHint=True, title="Cancel Improvements job"),
        "description": "Cancel one queued or process-owned Improvements job in exactly one scope.",
        "inputSchema": {
            "type": "object",
            "properties": {"scope": _STR, "job_id": _INT},
            "required": ["scope", "job_id"],
        },
    },
    {
        "name": "act_on_improvement_case",
        "title": "Act on Improvements case",
        "annotations": dict(WRITES, title="Act on Improvements case"),
        "description": "Apply a reviewed case action. approve only ensures an opaque Todo card and never launches it.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "scope": _STR,
                "case_id": _INT,
                "action": {
                    "type": "string",
                    "enum": [
                        "merge",
                        "split",
                        "false_positive",
                        "snooze",
                        "watch",
                        "approve",
                        "reopen",
                    ],
                },
                "reason": _STR,
                "target_case_id": _INT,
                "signal_ids": {"type": "array", "items": _INT},
                "snooze_until": _STR,
                "expected_revision": _INT,
            },
            "required": ["scope", "case_id", "action", "expected_revision"],
        },
    },
    {
        "name": "run_improvement_eval",
        "title": "Run Improvements evaluation",
        "annotations": dict(WRITES, title="Run Improvements evaluation"),
        "description": "Queue a baseline or candidate EvaluationPack run in a disposable detached worktree.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "scope": _STR,
                "case_id": _INT,
                "phase": {"type": "string", "enum": ["baseline", "candidate"]},
                "repo": _STR,
                "git_ref": _STR,
            },
            "required": ["scope", "case_id", "phase", "repo", "git_ref"],
        },
    },
]


# The arguments arrive as an arbitrary JSON object, so the table is typed for
# what a handler is actually handed rather than for what each one hopes.
OPS: dict[str, Callable[[sqlite3.Connection, dict], object]] = {
    "get_improvements_profile": lambda _conn, a: (
        improvements_integration.resolve_store(db_path(), a["scope"]).profile()
        | {
            "signal_summary": improvements_integration.resolve_store(
                db_path(), a["scope"]
            ).signal_summary()
        }
    ),
    "record_improvement_signal": lambda _conn, a: watchers.IMPROVEMENTS_RUNTIME.record_signals(
        db_path(), a
    ),
    "list_improvement_cases": lambda _conn, a: {
        "interface_version": improvements_api.API_VERSION,
        "scope": a["scope"],
        "cases": improvements_integration.resolve_store(db_path(), a["scope"]).cases(
            a.get("state"), int(a.get("limit", 100))
        ),
    },
    "get_improvement_case": lambda _conn, a: (
        {
            "interface_version": improvements_api.API_VERSION,
            "scope": a["scope"],
        }
        | improvements_integration.resolve_store(db_path(), a["scope"]).case(int(a["case_id"]))
    ),
    "update_improvements_profile": lambda _conn, a: watchers.IMPROVEMENTS_RUNTIME.set_profile(
        db_path(), a
    ),
    "analyze_improvements": lambda _conn, a: watchers.IMPROVEMENTS_RUNTIME.queue_analysis(
        db_path(), a["scope"], a.get("trigger", "manual")
    ),
    "improvements_cancel_job": lambda _conn, a: watchers.IMPROVEMENTS_RUNTIME.cancel_job(
        db_path(), a["scope"], int(a["job_id"])
    ),
    "act_on_improvement_case": lambda _conn, a: watchers.IMPROVEMENTS_RUNTIME.act_on_case(
        db_path(), int(a["case_id"]), a
    ),
    "run_improvement_eval": lambda _conn, a: watchers.IMPROVEMENTS_RUNTIME.queue_eval(db_path(), a),
}

#: The names this module publishes, which is what gates them on the module being
#: enabled. Derived rather than restated: a hand-written second list is how a
#: tool ends up ungated.
TOOL_NAMES = frozenset(OPS)
