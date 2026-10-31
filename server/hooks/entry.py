"""`valkama hook <client> <event>`: the command a client hook runs.

It reads one hook input from stdin. A lifecycle event is written into the
store, or spooled when the store cannot take it. `claude pre-tool-use` is a
pure transform: it prints the output that adds the session identity to a
Valkama tool call, and never touches the store.

The contract with the client is the same in every case: exit 0, and print
nothing unless the identity transform has an answer. A hook that failed its
client because Valkama is down would make Valkama the thing that breaks a
session, and Claude adds `SessionStart` stdout to the model's context, so a
stray line there is a prompt injection. A diagnostic goes to stderr.

`valkama.py` dispatches here before it imports the command line, so a hook
loads neither the MCP nor the HTTP surface. The lifecycle path imports the
store module for the store's path and schema version; the transform does not.
"""

from __future__ import annotations

import json
import sys
import time
import uuid
from typing import BinaryIO

from . import normalize

#: The most stdin a hook reads. A Valkama call's arguments are far below it;
#: anything larger is not an input this command was written for.
MAX_INPUT_BYTES = 1024 * 1024

USAGE = "usage: valkama hook <claude|codex> <event>"


def main(
    argv: list[str] | None = None,
    stdin: BinaryIO | None = None,
    stdout: BinaryIO | None = None,
) -> int:
    """Run one hook and return its exit status, which is always 0."""

    arguments = sys.argv[2:] if argv is None else argv
    try:
        _run(
            arguments,
            stdin if stdin is not None else sys.stdin.buffer,
            stdout if stdout is not None else sys.stdout.buffer,
        )
    # A hook never fails its client: whatever went wrong is reported where the
    # client does not read it, and the session goes on.
    except Exception as error:  # noqa: BLE001
        _note(f"{type(error).__name__}: {error}")
    return 0


def _note(message: str) -> None:
    sys.stderr.write(f"valkama hook: {message}\n")


def _run(arguments: list[str], stdin: BinaryIO, stdout: BinaryIO) -> None:
    if len(arguments) != 2:
        _note(USAGE)
        return
    client, event = arguments
    raw = stdin.read(MAX_INPUT_BYTES + 1)
    if event == normalize.IDENTITY_EVENT and client in normalize.IDENTITY_CLIENTS:
        payload = normalize.parse_input(raw) if len(raw) <= MAX_INPUT_BYTES else None
        output = normalize.identity_output(payload) if payload is not None else None
        if output is not None:
            stdout.write(json.dumps(output, ensure_ascii=False).encode("utf-8"))
            stdout.flush()
        return
    if event not in normalize.CLIENT_EVENTS.get(client, frozenset()):
        _note(f"no {event!r} event for {client!r}; {USAGE}")
        return
    payload = normalize.parse_input(raw) if len(raw) <= MAX_INPUT_BYTES else None
    if payload is None:
        return
    occurred_ns = time.time_ns()
    record = normalize.lifecycle_event(
        client,
        event,
        payload,
        event_uid=str(uuid.uuid4()),
        occurred_at=normalize.timestamp(occurred_ns),
    )
    if record is None:
        return
    # Only here: the identity transform above must not load the store.
    from .. import store
    from . import ingest

    ingest.deliver(
        record,
        store_path=store.db_path(),
        schema_version=store.STORE_SCHEMA_VERSION,
        occurred_ns=occurred_ns,
        now=normalize.timestamp(time.time_ns()),
    )
