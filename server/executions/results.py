"""What a finished attempt means for the work.

The runner owns process shape: it spawns, polls and stops, and knows nothing
about what any of that means. This module is the other side of that sentence —
whether an attempt delivered, whether a review returned the typed verdict its
mode requires, whether a claim that nothing needed changing was one the packet
allowed. All of it used to live in `runner.py`, where a caller reading
`OUTCOMES` was reading a verdict on the work out of the module whose charter
says it has no opinion about the work.

The vocabularies moved with the function that applies them, because they are
the same decision: `OUTCOMES` is the list of things a launch can be said to
have done, and `DISPOSITIONS` and `REVIEW_VERDICTS` are what a review owes on
top of that. `RESULT_SCHEMA` is the client-enforced shape of exactly those
words, which is why it is here and not beside the command line that carries it.

Per-client knowledge is deliberately absent. Where a client leaves its result
and which key of its own envelope holds it is the driver's answer; this module
asks the driver that owns the client and never names one.
"""

from __future__ import annotations

import json
import os
from collections.abc import Sequence

from .drivers import driver_for, json_object

#: What an attempt can be said to have done. `refused` and `launch_failed` are
#: not the same failure: one client ran and would not deliver, the other never
#: started.
OUTCOMES = (
    "launch_failed",
    "refused",
    "expected_no_change",
    "unexpected_no_change",
    "partial",
    "complete",
)
#: What the packet asked the attempt to do, which is what makes a no-op either
#: a delivery or a miss. Repeated back by the client so the two can disagree
#: visibly instead of silently.
EXPECTED_EFFECTS = ("change_required", "no_change_acceptable", "read_only_finding")
#: A launch is a review only when the owner said so, and the empty string is
#: that answer.
REVIEW_MODES = ("", "decision_review", "acceptance_review", "adversarial_review")
#: The verdict each review mode takes, exactly. A review that answered in
#: another mode's words answered a question nobody asked.
REVIEW_VERDICTS = {
    "decision_review": ("proceed", "change", "stop"),
    "acceptance_review": ("ship", "fix-first", "rethink"),
    "adversarial_review": ("risk-found", "no-material-risk-found"),
}
#: What a review must say happened to each finding it raised.
DISPOSITIONS = (
    "resolved",
    "deferred-with-owner",
    "rejected-with-evidence",
    "blocked",
)
#: How much of a result is kept. A client that wrote more than this wrote a
#: transcript, and the delivery is the part that fits.
MAX_RESULT_CHARS = 16000
#: How many findings one review may dispose of. A review with more than this is
#: not a review of a bounded packet.
MAX_DISPOSITIONS = 100

RESULT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["outcome", "expected_effect", "delivery", "oracle", "unresolved"],
    "properties": {
        "outcome": {"type": "string", "enum": list(OUTCOMES)},
        "expected_effect": {"type": "string", "enum": list(EXPECTED_EFFECTS)},
        "delivery": {"type": "string"},
        "oracle": {"type": "string"},
        "unresolved": {"type": "string"},
        "review_verdict": {"type": "string"},
        "dispositions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["finding", "status", "rationale"],
                "properties": {
                    "finding": {"type": "string"},
                    "status": {"type": "string", "enum": list(DISPOSITIONS)},
                    "rationale": {"type": "string"},
                },
            },
        },
    },
}


def result_schema(review_mode: str) -> dict:
    """Return the client-enforced schema, specialized for its review mode."""

    schema = json.loads(json.dumps(RESULT_SCHEMA))
    if review_mode:
        schema["required"] += ["review_verdict", "dispositions"]
        schema["properties"]["review_verdict"]["enum"] = list(REVIEW_VERDICTS[review_mode])
    return schema


def contract_prompt(prompt: str, expected_effect: str, review_mode: str) -> str:
    """The packet prompt with the result contract spelled out after it.

    Here rather than beside the command line because every sentence of it is
    about what these words mean: which outcome is allowed when, and that an exit
    code is not a delivery.
    """

    return (
        (prompt or "Continue the claimed card.")
        + "\n\nVALKAMA RESULT CONTRACT\n"
        + "Return the final result through the client-enforced JSON schema. "
        + f"The packet expected_effect is {expected_effect!r}; repeat it exactly. "
        + "Use complete only when every owned output and required oracle is satisfied; "
        + "use expected_no_change only when the packet permits a no-op and the oracle proves it. "
        + "A zero exit code alone is not delivery."
        + (
            f" This is {review_mode}; return its typed review_verdict and a "
            "disposition for every finding."
            if review_mode
            else ""
        )
    )


def classify(
    *,
    client: str,
    expected_effect: str,
    review_mode: str,
    exit_code: int,
    lines: Sequence[str],
    result_path: str = "",
) -> dict:
    """The verdict on one finished attempt, from what it actually returned.

    Takes what the process left behind rather than the launch that owns it, so
    nothing here has to import the runner and the runner does not have to hand
    over its own record of a live launch to learn what it meant.
    """

    candidate = _candidate(client, lines, result_path)
    if candidate is None:
        outcome = (
            "refused"
            if exit_code
            else ("unexpected_no_change" if expected_effect == "change_required" else "partial")
        )
        return {
            "outcome": outcome,
            "expected_effect": expected_effect,
            "delivery": "No valid structured delivery result was returned.",
            "oracle": f"client process exit code {exit_code}; delivery not verified",
            "unresolved": "The primary must inspect the checkout and run the packet oracle.",
            "review_verdict": "",
            "dispositions": [],
            "structured": False,
        }

    outcome = str(candidate.get("outcome", ""))
    expected = str(candidate.get("expected_effect", ""))
    if outcome not in OUTCOMES or expected not in EXPECTED_EFFECTS:
        outcome = "partial"
    if expected != expected_effect:
        outcome = "partial"
    if outcome == "expected_no_change" and expected_effect == "change_required":
        outcome = "unexpected_no_change"
    review_verdict = str(candidate.get("review_verdict", ""))
    raw_dispositions = candidate.get("dispositions")
    valid_dispositions = []
    if isinstance(raw_dispositions, list):
        for value in raw_dispositions[:MAX_DISPOSITIONS]:
            if not isinstance(value, dict) or value.get("status") not in DISPOSITIONS:
                continue
            valid_dispositions.append(
                {
                    "finding": str(value.get("finding", ""))[:2000],
                    "status": value["status"],
                    "rationale": str(value.get("rationale", ""))[:4000],
                }
            )
    dispositions_valid = (
        isinstance(raw_dispositions, list)
        and len(valid_dispositions) == len(raw_dispositions[:MAX_DISPOSITIONS])
        and len(raw_dispositions) <= MAX_DISPOSITIONS
    )
    dispositions = valid_dispositions
    if review_mode and (
        review_verdict not in REVIEW_VERDICTS[review_mode] or not dispositions_valid
    ):
        outcome = "partial"
    if exit_code and outcome in ("complete", "expected_no_change"):
        outcome = "partial"
    return {
        "outcome": outcome,
        "expected_effect": expected_effect,
        "delivery": str(candidate.get("delivery", ""))[:MAX_RESULT_CHARS],
        "oracle": str(candidate.get("oracle", ""))[:MAX_RESULT_CHARS],
        "unresolved": str(candidate.get("unresolved", ""))[:MAX_RESULT_CHARS],
        "review_verdict": review_verdict[:64],
        "dispositions": dispositions,
        "structured": True,
    }


def _candidate(client: str, lines: Sequence[str], result_path: str) -> dict | None:
    """The structured result this attempt returned, wherever its client puts one.

    The named file first, because a client that was given one was told to write
    the result there and its stdout is then narration. Stdout is read newest
    first, and what a line of it means is asked of the driver.
    """

    if result_path and os.path.isfile(result_path):
        try:
            with open(result_path, encoding="utf-8") as handle:
                candidate = json_object(handle.read(MAX_RESULT_CHARS + 1))
            if candidate is not None:
                return candidate
        except (OSError, UnicodeError):
            pass
    driver = driver_for(client)
    for line in reversed(lines):
        try:
            envelope = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(envelope, dict):
            continue
        reading = driver.read_stdout_event(envelope)
        if reading.result is not None:
            return reading.result
        # A line that is the result itself, in no client's envelope. The schema
        # is Valkama's own, so a document answering it is one whoever printed it.
        if "outcome" in envelope:
            return envelope
    return None


__all__ = [
    "DISPOSITIONS",
    "EXPECTED_EFFECTS",
    "MAX_DISPOSITIONS",
    "MAX_RESULT_CHARS",
    "OUTCOMES",
    "RESULT_SCHEMA",
    "REVIEW_MODES",
    "REVIEW_VERDICTS",
    "classify",
    "contract_prompt",
    "result_schema",
]
