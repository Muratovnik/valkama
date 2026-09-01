"""The shape a usage projection has, and the vocabulary that makes it honest.

Valkama defines a small normalized contract and does not define a span. That is
the whole architectural claim of this layer: a backend that stores traces keeps
its own schema, and what crosses into this product is a handful of numbers with
their provenance attached.

The vocabulary is the load-bearing part. A number here is never bare: it says
whether the source reported it, whether Valkama derived it, or whether nobody
looked. Without that distinction a zero means two opposite things — "this
attempt used nothing" and "no journal was configured" — and every reader picks
the wrong one, because a dashboard makes zero look like a measurement.
"""

from __future__ import annotations

#: How one value came to be. Ordered from strongest to weakest.
#:
#: `unsupported` is not a failure: it is a source saying it does not carry this
#: field at all, which is a different answer from a source that carries it and
#: saw nothing.
QUALITIES = ("observed", "derived", "estimated", "unknown", "unsupported")

#: How complete a group of values is, for a reader deciding whether to trust a
#: total. `partial` is the answer whenever some sessions of an attempt answered
#: and others did not — the sum is real and it is not the whole.
COVERAGE = ("confirmed", "partial", "unknown")

#: What a token count is broken into. Every source reports a subset; the ones it
#: does not report stay absent rather than becoming zero.
#:
#: The cache is two fields because it is two quantities. A cache *read* is
#: counted again on every request that reuses the prefix, so it grows without
#: bound over a long session; a cache *write* happens once for the tokens
#: actually stored. A single `cached_input` field summed both, and a real
#: session produced 1.4 billion of it beside six thousand of input — each half
#: true, the sum an answer to no question.
TOKEN_FIELDS = ("input", "cached_read", "cache_write", "output", "reasoning", "total")


#: What a tool outcome is called, from the status a hook reported. One list, so
#: the space-wide leaderboard and one attempt's own calls agree about what an
#: error is; the two copies that preceded it disagreed about `completed`.
_OK = ("ok", "success", "succeeded", "complete", "completed")
_ERROR = ("error", "failed", "failure")


def tool_outcome(status: object) -> str:
    """`ok`, `error`, or `unknown` — never a fourth thing, and never a guess."""

    value = str(status or "").strip().lower()
    if value in _OK:
        return "ok"
    if value in _ERROR:
        return "error"
    return "unknown"


def quantity(value: object, quality: str) -> dict:
    """One number and how it was obtained, or a stated absence.

    A value of `None` forces the quality to `unknown`: a field cannot claim to
    have been observed and carry nothing, and letting the two disagree is how a
    projection starts lying quietly.
    """

    if quality not in QUALITIES:
        raise ValueError(f"unknown field quality {quality!r}")
    if value is None:
        return {"value": None, "quality": "unknown" if quality != "unsupported" else quality}
    return {"value": value, "quality": quality}


def coverage_of(answered: int, asked: int) -> str:
    """How complete a group is, from how many sources answered out of how many.

    Nothing asked is `unknown` rather than `confirmed`: an attempt with no
    session to read has not been measured, however tidy the empty total looks.
    """

    if asked <= 0 or answered <= 0:
        return "unknown"
    return "confirmed" if answered >= asked else "partial"


def provenance(adapter_id: str, connection_id: str, observed_at: str, source_quality: str) -> dict:
    """Who answered, from where, and when — attached to every projection.

    Kept even when the answer is empty. "No adapter answered" is a diagnosis a
    reader can act on; a projection with no provenance is one they cannot.
    """

    return {
        "adapter_id": adapter_id,
        "connection_id": connection_id,
        "observed_at": observed_at,
        "source_quality": source_quality,
    }


__all__ = [
    "COVERAGE",
    "QUALITIES",
    "TOKEN_FIELDS",
    "coverage_of",
    "provenance",
    "quantity",
    "tool_outcome",
]
