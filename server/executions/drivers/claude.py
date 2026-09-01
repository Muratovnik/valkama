"""Claude Code as an execution driver.

Two of its properties are why the identity rules elsewhere can be strict. It
accepts a session identity chosen by the caller, so a launch knows which session
an attempt is before the process exists rather than after it speaks; and it can
be told on the command line that the delegation tool is unavailable, so the
executor role of ADR 0008 is enforced rather than requested. A prompt asking a
model not to delegate is advice, and advice is not a contract.
"""

from __future__ import annotations

import json
from collections.abc import Mapping

from .contract import (
    MAX_SESSION_ID_CHARS,
    CommandRequest,
    DriverCapabilities,
    DriverError,
    StdoutReading,
    json_object,
)

#: Aliases the client documents. A full model name is accepted too, so this is
#: what a chooser offers rather than what it permits.
MODELS = ("fable", "opus", "sonnet", "haiku")
#: Exactly what `--effort` takes. `ultracode` is the client's own name for its
#: highest setting and is deliberately here: leaving it out would make a value
#: the client accepts look like one Valkama had rejected.
EFFORTS = ("low", "medium", "high", "xhigh", "max", "ultracode")
#: Where this client puts the structured result inside its own `--output-format
#: json` envelope, in the order to look. Three spellings because the field has
#: been renamed and the older ones are still emitted by installed versions; a
#: caller that guessed one of them would read the wrong result on the others.
RESULT_KEYS = ("structured_output", "structuredOutput", "result")
#: And where it names the session that produced it, same reason.
SESSION_KEYS = ("session_id", "sessionId")

_CAPABILITIES = DriverCapabilities(
    client="claude",
    adapter_lineage_id="claude-code-execution",
    models=MODELS,
    efforts=EFFORTS,
    exact_resume=True,
    assigns_session_identity=True,
    mechanical_executor=True,
    result_transport="stdout",
    telemetry_configuration="environment",
)


def capabilities() -> DriverCapabilities:
    return _CAPABILITIES


def argv(request: CommandRequest) -> list[str]:
    """The exact command line, refusing what this client would misread.

    `--json-schema` carries the schema inline rather than by path: this client
    takes the document itself, and passing a path would hand the model a string
    it would try to read as a schema.
    """

    if request.effort and request.effort not in EFFORTS:
        raise DriverError(f"claude does not accept effort {request.effort!r}, use one of {EFFORTS}")
    command = [request.binary, "-p", request.prompt, "--output-format", "json"]
    if request.schema is not None:
        command += ["--json-schema", json.dumps(request.schema, separators=(",", ":"))]
    if request.resume:
        if not request.session_id:
            raise DriverError("an exact Claude session id is required to resume")
        command += ["--resume", request.session_id]
    elif request.session_id:
        command += ["--session-id", request.session_id]
    if request.model:
        command += ["--model", request.model]
    if request.effort:
        command += ["--effort", request.effort]
    if request.no_delegation:
        command += ["--disallowedTools", "Agent"]
    return command


def read_stdout_event(event: Mapping[str, object]) -> StdoutReading:
    """What one line of this client's JSON output said about the attempt.

    The result arrives on stdout here — `result_transport` says so — so this is
    where a delivery is found, wrapped in whichever of the envelope keys this
    installation uses.
    """

    session = ""
    for key in SESSION_KEYS:
        value = event.get(key)
        if isinstance(value, str) and value:
            session = value[:MAX_SESSION_ID_CHARS]
            break
    for key in RESULT_KEYS:
        candidate = json_object(event.get(key))
        # A wrapped object with no outcome is some other part of the envelope,
        # not a delivery this client refused to fill in.
        if candidate is not None and "outcome" in candidate:
            return StdoutReading(session_id=session, result=candidate)
    return StdoutReading(session_id=session)


__all__ = [
    "EFFORTS",
    "MODELS",
    "RESULT_KEYS",
    "SESSION_KEYS",
    "argv",
    "capabilities",
    "read_stdout_event",
]
