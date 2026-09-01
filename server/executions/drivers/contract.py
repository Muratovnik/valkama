"""The shape every execution driver answers in.

Kept apart from the registry so a driver module can import it without importing
its siblings through the package, which is what would make the two drivers
depend on each other for nothing.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol

#: How much of a session identity is kept. A client that announced something
#: longer than this announced something that is not an identity.
MAX_SESSION_ID_CHARS = 128


class DriverError(ValueError):
    """This driver cannot build the command it was asked for."""


def json_object(value: object) -> dict | None:
    """One JSON object, whether the client handed it over or its text.

    Both forms are real: a client may put the structured result in its envelope
    as an object, or as a string holding one, and a file transport hands over
    the text of a whole document. Anything that is neither is not a result.
    """

    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None
    return None


@dataclass(frozen=True)
class StdoutReading:
    """What one line of a client's stdout said about the attempt running it.

    Both fields default to absent because most lines say neither thing: a
    client streams progress, and only some of it announces an identity or
    carries the structured result. Which lines those are is the driver's
    knowledge — `thread.started` is a Codex word and `structured_output` a
    Claude Code one — and stating it here is what keeps the runner from
    knowing either.
    """

    session_id: str = ""
    result: dict | None = None


@dataclass(frozen=True)
class DriverCapabilities:
    """What one client accepts, stated once so nothing has to assume it.

    Every field answers a question a launch dialog or a correlation rule would
    otherwise answer by guessing. `models` is advisory — a client takes any name
    its account can reach, and these are the aliases it documents — while
    `efforts` is exact: a value outside it is refused by the client itself.
    """

    client: str
    #: The Kernel adapter this driver is registered as. Kept here so the
    #: registry that publishes the adapter and the execution row that records
    #: which adapter ran are naming it from one place rather than two.
    adapter_lineage_id: str
    #: Aliases the client documents. Empty means it publishes none, not that it
    #: takes none, so a chooser offers these and still allows a typed name.
    models: tuple[str, ...]
    #: Reasoning-effort values the client accepts, exactly. Differs per client.
    efforts: tuple[str, ...]
    #: Whether a previous attempt can be continued by its exact identity. Every
    #: driver here can; the field exists because "resume the last session" is
    #: the correlation shortcut this product forbids, and a driver that could
    #: only do that has to be able to say so.
    exact_resume: bool
    #: Whether Valkama chooses the session identity before the process starts.
    #: False means the client mints it and announces it, so the identity is
    #: known only once the process has spoken.
    assigns_session_identity: bool
    #: Whether the command line can take delegation away. Where it cannot, the
    #: executor role is advisory and a caller must say so rather than imply it.
    mechanical_executor: bool
    #: Where the structured result arrives: on stdout inside the client's own
    #: envelope, or in a file the caller names.
    result_transport: str
    #: How telemetry is turned on for a spawned process: through environment
    #: variables a launch can set, through the client's own configuration file,
    #: or not at all.
    telemetry_configuration: str

    def as_dict(self) -> dict:
        """The wire form, for a surface that hands this to an interface."""

        return {
            "client": self.client,
            "adapter_lineage_id": self.adapter_lineage_id,
            "models": list(self.models),
            "efforts": list(self.efforts),
            "exact_resume": self.exact_resume,
            "assigns_session_identity": self.assigns_session_identity,
            "mechanical_executor": self.mechanical_executor,
            "result_transport": self.result_transport,
            "telemetry_configuration": self.telemetry_configuration,
        }


@dataclass(frozen=True)
class CommandRequest:
    """One invocation, in terms no client owns.

    The caller resolves the binary and owns any temporary file, because the
    caller owns their lifetime; the driver decides which of them this client
    needs and refuses when one it needs is missing.
    """

    binary: str
    prompt: str
    model: str = ""
    effort: str = ""
    #: The structured-result schema, for a client that takes it on the command
    #: line. `None` asks for a run with no enforced result shape.
    schema: dict | None = None
    #: The same schema already written to disk, for a client that reads a path.
    schema_path: str = ""
    #: Where the client should leave its final message, for a file transport.
    result_path: str = ""
    session_id: str = ""
    resume: bool = False
    #: Ask the client to run without delegating. Honoured only where
    #: `mechanical_executor` is true; a driver that cannot enforce it ignores
    #: the flag rather than pretending in a prompt.
    no_delegation: bool = False


class ExecutionDriver(Protocol):
    """What the registry needs from a driver, so a module can be one.

    Structural rather than a base class on purpose: each driver is a module,
    and a module cannot inherit. The three members are the whole contract — say
    what this client supports, build one command line for it, and read what it
    writes back.
    """

    def capabilities(self) -> DriverCapabilities: ...

    def argv(self, request: CommandRequest) -> list[str]: ...

    def read_stdout_event(self, event: Mapping[str, object]) -> StdoutReading: ...


__all__ = [
    "MAX_SESSION_ID_CHARS",
    "CommandRequest",
    "DriverCapabilities",
    "DriverError",
    "ExecutionDriver",
    "StdoutReading",
    "json_object",
]
