"""Codex as an execution driver.

It mints its own session identity and announces it as a `thread.started` line on
stdout, which is why `--json` is not optional here. Without it the client still
runs and still finishes, and Valkama simply never learns which session did the
work — leaving a launch that can only be correlated by time or by directory,
which is exactly the guesswork §6.1 forbids. The flag being conditional was the
one real difference between the two copies of this command line that used to
exist, so it is stated as a rule rather than as an argument.

The structured result arrives in a file rather than on stdout, so a caller that
wants one has to name where it goes.
"""

from __future__ import annotations

from collections.abc import Mapping

from .contract import (
    MAX_SESSION_ID_CHARS,
    CommandRequest,
    DriverCapabilities,
    DriverError,
    StdoutReading,
)

#: The stdout event that carries the identity this client minted, and the two
#: spellings of the field on it. Named here because it is this client's word:
#: nothing outside this module has any reason to know it.
THREAD_STARTED = "thread.started"
THREAD_KEYS = ("thread_id", "threadId")

#: What a chooser offers. Codex resolves a model against the account, so a typed
#: name is accepted and this is a suggestion list rather than a permission list.
#: These are the three the improvements analyzer already suggests; that copy is
#: the reason this list is here at all, so it starts by agreeing with it.
MODELS = ("gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna")
#: Exactly what `model_reasoning_effort` takes, from the client's configuration
#: reference. `max` is deliberately absent: it is Claude Code's word, and the
#: shared tuple this replaced accepted it here, where the client refuses it.
EFFORTS = ("none", "minimal", "low", "medium", "high", "xhigh")

_CAPABILITIES = DriverCapabilities(
    client="codex",
    adapter_lineage_id="codex-execution",
    models=MODELS,
    efforts=EFFORTS,
    exact_resume=True,
    assigns_session_identity=False,
    mechanical_executor=False,
    result_transport="file",
    telemetry_configuration="client-config",
)


def capabilities() -> DriverCapabilities:
    return _CAPABILITIES


def argv(request: CommandRequest) -> list[str]:
    """The exact command line, with the identity flag always on.

    Options come before the positional task on a resume as well as on a fresh
    run: `codex exec resume <session> <prompt>` reads its two positionals in
    order, so an option placed after them is taken for one of them.
    """

    if request.effort and request.effort not in EFFORTS:
        raise DriverError(f"codex does not accept effort {request.effort!r}, use one of {EFFORTS}")
    if request.schema is not None and not request.schema_path:
        raise DriverError("codex reads its result schema from a file; name the path")
    options: list[str] = []
    if request.schema_path:
        options += ["--output-schema", request.schema_path]
    if request.result_path:
        options += ["-o", request.result_path]
    if request.model:
        options += ["--model", request.model]
    if request.effort:
        options += ["-c", f'model_reasoning_effort="{request.effort}"']
    if request.resume:
        if not request.session_id:
            raise DriverError("an exact Codex session id is required to resume")
        return [
            request.binary,
            "exec",
            "resume",
            "--json",
            *options,
            request.session_id,
            request.prompt,
        ]
    return [request.binary, "exec", "--json", *options, request.prompt]


def read_stdout_event(event: Mapping[str, object]) -> StdoutReading:
    """The identity this client announces, and nothing else.

    No result is read from stdout: `result_transport` is `file` here, so the
    structured delivery arrives where `-o` pointed it. A line of this client's
    stream that looked like a result would be its narration of one.
    """

    if event.get("type") != THREAD_STARTED:
        return StdoutReading()
    for key in THREAD_KEYS:
        value = event.get(key)
        if isinstance(value, str) and value:
            return StdoutReading(session_id=value[:MAX_SESSION_ID_CHARS])
    return StdoutReading()


__all__ = [
    "EFFORTS",
    "MODELS",
    "THREAD_KEYS",
    "THREAD_STARTED",
    "argv",
    "capabilities",
    "read_stdout_event",
]
