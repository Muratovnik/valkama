"""`valkama hook <client> <event>`: the command a client hook runs.

It reads one hook input from stdin. A lifecycle event is written into the
store, or spooled when the store cannot take it. `claude pre-tool-use` is a
pure transform: it prints the output that adds the session identity to a
Valkama tool call, and never touches the store. `post-tool-use`,
`user-prompt-submit` and `stop` may also answer with a notice of what a person
did on the work this session holds, and `claude watch` is the background hook
that wakes an idle session with that notice (`notify`).

The contract with the client is the same in every case: exit 0, and print
nothing but the transform's output or a notice. A hook that failed its client
because Valkama is down would make Valkama the thing that breaks a session, and
Claude adds `SessionStart` stdout to the model's context, so a stray line there
is a prompt injection. A diagnostic goes to stderr. The one other exit status
is the watcher's 2, which is how Claude Code's `asyncRewake` is told to wake.

`valkama.py` dispatches here before it imports the command line, so a hook
loads neither the MCP nor the HTTP surface. Nothing is imported here at module
level: `post-tool-use` runs on every tool call, and the notice path loads only
`notify`. The lifecycle path imports the store module for the store's path and
schema version; the transform does not.
"""

from __future__ import annotations

import sys

TYPE_CHECKING = False
if TYPE_CHECKING:
    from collections.abc import Callable
    from typing import BinaryIO, TypeVar

    from . import place

    T = TypeVar("T")

#: The most stdin a hook reads. A Valkama call's arguments are far below it;
#: anything larger is not an input this command was written for.
MAX_INPUT_BYTES = 1024 * 1024

USAGE = "usage: valkama hook <claude|codex> <event>"

#: The identity transform's event, and the clients it is for. Codex carries the
#: same identity in every call's `_meta`, so it needs no transform.
IDENTITY_EVENT = "pre-tool-use"
IDENTITY_CLIENTS = frozenset({"claude"})
#: `normalize.AGENT_TOOLS`, which a hook on any other tool does not load.
_AGENT_TOOLS = frozenset({"Agent", "Task"})
#: The one event that reads where its session is open, ancestors included.
SESSION_START = "session-start"


def main(
    argv: list[str] | None = None,
    stdin: BinaryIO | None = None,
    stdout: BinaryIO | None = None,
) -> int:
    """Run one hook and return its exit status: 0, or the watcher's 2 to wake."""

    arguments = sys.argv[2:] if argv is None else argv
    try:
        status = _run(
            arguments,
            stdin if stdin is not None else sys.stdin.buffer,
            stdout if stdout is not None else sys.stdout.buffer,
        )
    # A hook never fails its client: whatever went wrong is reported where the
    # client does not read it, and the session goes on.
    except Exception as error:  # noqa: BLE001
        _note(f"{type(error).__name__}: {error}")
        return 0
    return 2 if status == 2 else 0


def _note(message: str) -> None:
    # Bytes: under `-I` stderr takes the console's code page, and a path or a
    # message it cannot encode would raise from this very handler.
    line = f"valkama hook: {message}\n"
    try:
        buffer = getattr(sys.stderr, "buffer", None)
        if buffer is None:
            sys.stderr.write(line)
        else:
            buffer.write(line.encode("utf-8", "replace"))
            buffer.flush()
    except (OSError, ValueError):
        pass


def _run(arguments: list[str], stdin: BinaryIO, stdout: BinaryIO) -> int:
    if len(arguments) != 2:
        _note(USAGE)
        return 0
    client, event = arguments
    raw = stdin.read(MAX_INPUT_BYTES + 1)
    if event == IDENTITY_EVENT and client in IDENTITY_CLIENTS:
        _identity(raw, stdout)
        return 0
    from . import notify

    if event == notify.WATCH_EVENT and client == "claude":
        payload = notify.parse(raw) if len(raw) <= MAX_INPUT_BYTES else None
        return notify.watch(payload) if payload is not None else 0
    payload = notify.parse(raw) if len(raw) <= MAX_INPUT_BYTES else None
    # Each stage stands alone: a notice that failed must not cost the lifecycle
    # event, and a session end must stop its watcher whatever the store says.
    if event == "session-end" and payload is not None and client == "claude":
        _stage(notify.session_ended, payload)
    if event in notify.DELIVERY_EVENTS.get(client, {}) and payload is not None:
        answer = _stage(notify.deliver, client, event, payload)
        if answer is not None:
            stdout.write(answer)
            stdout.flush()
    if event == "post-tool-use" and (
        client != "claude" or payload is None or payload.get("tool_name") not in _AGENT_TOOLS
    ):
        return 0  # only the Agent tool's answer is a lifecycle event
    _lifecycle(client, event, payload)
    return 0


def _stage(action: Callable[..., T], *arguments: object) -> T | None:
    """One stage of a hook; a failure is reported on stderr and the next stage runs."""

    try:
        return action(*arguments)
    except Exception as error:  # noqa: BLE001 -- a hook never fails its client
        _note(f"{type(error).__name__}: {error}")
        return None


def _identity(raw: bytes, stdout: BinaryIO) -> None:
    import json
    import os

    from . import normalize, place

    payload = normalize.parse_input(raw) if len(raw) <= MAX_INPUT_BYTES else None
    if payload is None:
        return
    # The variables alone: a tool call reads no process snapshot.
    opened_in = place.classify("claude", place.whitelisted(os.environ)).opened_in
    output = normalize.identity_output(payload, opened_in=opened_in)
    if output is not None:
        stdout.write(json.dumps(output, ensure_ascii=False).encode("utf-8"))
        stdout.flush()


def _place(client: str) -> place.Place:
    """Where this session start finds its session open.

    The process snapshot is read here only: a session start is when a session
    opens in a client, and the one event that may say where it now is. A
    snapshot that fails costs the host product, never the event.
    """

    import os

    from . import place

    ancestors = _stage(place.ancestors) or ()
    return place.classify(client, place.whitelisted(os.environ), ancestors)


def _lifecycle(client: str, event: str, payload: dict | None) -> None:
    import time
    import uuid

    from . import normalize

    if event not in normalize.CLIENT_EVENTS.get(client, frozenset()):
        _note(f"no {event!r} event for {client!r}; {USAGE}")
        return
    if payload is None:
        return
    occurred_ns = time.time_ns()
    record = normalize.lifecycle_event(
        client,
        event,
        payload,
        event_uid=str(uuid.uuid4()),
        occurred_at=normalize.timestamp(occurred_ns),
        place=_place(client) if event == SESSION_START else None,
    )
    if record is None:
        return
    # Only here: the identity transform and the notice must not load the store.
    from .. import store
    from . import ingest

    ingest.deliver(
        record,
        store_path=store.db_path(),
        schema_version=store.STORE_SCHEMA_VERSION,
        occurred_ns=occurred_ns,
        now=normalize.timestamp(time.time_ns()),
    )
