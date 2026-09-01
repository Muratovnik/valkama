"""How a boundary reads one value out of a parsed query string.

Three modules wrote this rule out separately -- Planning, Executions and Memory
-- and by the time anyone compared them they said three different things. Two
treated `?scope=` as a value and one treated it as absent, so the same request
was a refusal on one boundary and a lookup for the empty string on another. The
rule lives here now, and each boundary supplies only its own refusal.

A repeated parameter is refused rather than resolved. `?state=dev&state=done`
has no honest reading: taking the first silently answers a question nobody
asked, and answering both would mean a filter the caller did not write.

A blank value is absent, which is the stricter of the two readings the copies
had. `?scope=` names no scope; accepting it as one turns a typo into a lookup
for something that cannot exist.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping

#: Each boundary raises its own error type, and all three take the same three
#: arguments, so the refusal is passed in rather than translated afterwards.
Refusal = Callable[[int, str, str], Exception]


def first(parameters: Mapping[str, list[str]], name: str, *, error: Refusal) -> str | None:
    """The one value given for this name, or None if none was."""

    values = [value for value in parameters.get(name) or [] if value != ""]
    if not values:
        return None
    if len(values) != 1:
        raise error(400, "invalid_request", f"{name} must occur at most once")
    return values[0]


def required(parameters: Mapping[str, list[str]], name: str, *, error: Refusal) -> str:
    """The one value given for this name, or a refusal naming what is missing."""

    value = first(parameters, name, error=error)
    if value is None:
        raise error(400, "invalid_request", f"{name} is required")
    return value
