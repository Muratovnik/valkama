"""What each agent client can actually do, and how it is invoked.

Two callers used to answer that question privately. `runner.client_argv` branched
on `packet.client` to build a command line, and `analyzer_contract.analyzer_client_argv`
carried a second copy of the same branch with a docstring saying so out loud —
"intentionally mirrors runner.client_argv without changing runner.py". A flag the
vendor renames therefore had to be found twice, and the two copies had already
drifted: only one of them passed `--json` to Codex, which is the flag that makes
that client announce its thread id, which is the only exact identity Valkama is
allowed to correlate an attempt by.

So a driver owns one client end to end: the command line, the identity policy,
and an honest statement of what the client cannot do. That last part is what
layer 2 needs. A launch dialog built from a fixed list of options offers every
client every option and lets the client refuse afterwards; a dialog built from
`capabilities()` offers what this client accepts and says why the rest is absent.

The differences are real, and the shared tables they replace flattened them:

* Reasoning effort is not one vocabulary. Claude Code takes `low`, `medium`,
  `high`, `xhigh`, `max` and `ultracode`; Codex takes `none`, `minimal`, `low`,
  `medium`, `high` and `xhigh`. The one tuple this replaced accepted `max` for
  Codex, which that client refuses, and rejected `minimal`, which it accepts.
* Session identity flows the opposite way per client. Valkama assigns Claude a
  UUID with `--session-id`, so the identity exists before the process does;
  Codex mints its own and announces it, so the identity is observed afterwards
  and only if `--json` is on.
* Delegation can be removed mechanically on one client and not the other. That
  asymmetry was already a warning on the packet; here a caller can read it
  before offering the role rather than after choosing it.
* Telemetry is configured differently. Claude Code reads `OTEL_*` environment
  variables once `CLAUDE_CODE_ENABLE_TELEMETRY` is set, so a launch can inject
  correlation attributes into the child. Codex configures its exporter in its
  own `config.toml` under `[otel]`, which a launch does not own — layer 3 has to
  reach it another way, and saying so here keeps that from being discovered as
  an unexplained absence of data.

A driver is a module rather than a class: it holds no state, and every one of
them would otherwise be a class with no instance data whose only purpose is to
be looked up by name — which is what a module already is.
"""

from __future__ import annotations

from . import claude, codex
from .contract import (
    CommandRequest,
    DriverCapabilities,
    DriverError,
    ExecutionDriver,
    StdoutReading,
    json_object,
)

#: Every client this build can launch, in the order a chooser should offer them.
_DRIVERS: tuple[ExecutionDriver, ...] = (claude, codex)
_BY_CLIENT: dict[str, ExecutionDriver] = {
    driver.capabilities().client: driver for driver in _DRIVERS
}

#: The client ids, in that same order. `runner` re-exports this as its own
#: `CLIENTS` so a caller validating a packet does not have to know where the
#: list is kept.
CLIENTS = tuple(_BY_CLIENT)


def driver_for(client: str) -> ExecutionDriver:
    """The one driver that speaks this client, or a refusal naming those that do."""

    driver = _BY_CLIENT.get(str(client or "").strip().lower())
    if driver is None:
        raise DriverError(f"unknown client {client!r}, use one of {list(CLIENTS)}")
    return driver


def capabilities_for(client: str) -> DriverCapabilities:
    """What this client supports, for a caller deciding what to offer."""

    return driver_for(client).capabilities()


def all_capabilities() -> tuple[DriverCapabilities, ...]:
    """Every driver's capabilities, so an interface is built without naming one."""

    return tuple(driver.capabilities() for driver in _DRIVERS)


__all__ = [
    "CLIENTS",
    "CommandRequest",
    "DriverCapabilities",
    "DriverError",
    "ExecutionDriver",
    "StdoutReading",
    "all_capabilities",
    "capabilities_for",
    "driver_for",
    "json_object",
]
