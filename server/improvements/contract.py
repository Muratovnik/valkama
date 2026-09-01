"""The fixed vocabulary of the Improvements interface, and the one error it raises.

`docs/improvements-contract.md` is the document these names implement: the three
interface identifiers a payload carries, the four enumerations a request is
checked against, and the bounds of the public signal packet.  Everything here is
a published value, so a change to this module is a change to that document.

This module imports nothing from its own package.  It is what
`sidecar_locks`, `sidecar_schema`, `sanitization` and `improvements` all need
before they can refuse a request, which is why it owns no behaviour of its own.
"""

from __future__ import annotations

API_VERSION = "improvements-api"
STORE_VERSION = "improvements-store"
EVENTS_VERSION = "improvements-events"


MAX_SIGNAL_COUNT = 100
MAX_SIGNAL_PACKET_BYTES = 16 * 1024
MAX_EXCERPT_CHARS = 1200


#: Where a signal may come from. `execution_result` could not exist until
#: an attempt was a durable record: before that a failure had nothing
#: stable to point at, and Improvements saw only what a session hook
#: happened to report. It is its own kind rather than a session event with
#: a different pointer, because a tool failing and an attempt not
#: delivering are different evidence about the same run.
SOURCE_KINDS = {
    "session_event",
    "execution_result",
    "agentmemory_lesson",
    "user_feedback",
}


ALLOWED_TARGETS = (
    "instructions",
    "skill",
    "tool-contract",
    "hook-lifecycle",
    "validator-eval",
    "documentation-process",
)


SEVERITIES = {"low": 1, "medium": 2, "high": 4, "critical": 8}


STATES = {
    "collecting",
    "open",
    "watching",
    "snoozed",
    "approved",
    "implementing",
    "validating",
    "resolved",
    "effective",
    "false_positive",
    "regressed",
}


class ImprovementError(ValueError):
    def __init__(self, code: str, message: str, status: int = 422, guard: str | None = None):
        super().__init__(message)
        self.code, self.status, self.guard = code, status, guard

    def payload(self) -> dict:
        error = {"code": self.code, "message": str(self)}
        if self.guard:
            error["guard"] = self.guard
        return {"interface_version": API_VERSION, "error": error}
