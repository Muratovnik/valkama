"""The launcher's three read-only answers, given without loading the command line.

The tray and the desktop app ask the managed launcher the same questions every
time a window opens: what runtime identity a new server would have (`runtime`),
whether the launcher is installed as its manifest says (`launcher status`), and
who holds the port (`launcher listener status`). Each is a few milliseconds of
work, but answering it through `cli` imported every surface first -- the MCP
catalogue, the HTTP handlers, the store -- which cost about 150 ms per question,
on the path between a click and a window.

So `valkama.py` hands these exact command lines here before it imports `cli`.
Anything that is not one of them, and any question that ends in an error,
returns None, and the full command line answers it instead: the error wording
then has one owner, and nothing here can drift from what `cli` would print.
"""

from __future__ import annotations

import contextlib
import json
import sys
from collections.abc import Sequence

from . import launcher, static_assets


def write_utf8() -> None:
    """Say what this process writes instead of letting the console decide.

    A planning space is full of Cyrillic titles and arrows. Redirect this output
    on a CP1251 console and the encoder raises on the first character it has no
    room for, which is what `summary` did from its first commit: the session
    hooks that run it were one arrow in a title away from failing.

    The same statement this project makes for authored text and for protocol
    bytes, applied to the one surface a console gets to re-encode.
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            with contextlib.suppress(OSError, ValueError):
                reconfigure(encoding="utf-8", errors="strict")


def print_document(result: dict[str, object]) -> None:
    """How every launcher command prints its answer."""
    print(json.dumps(result, ensure_ascii=False, indent=1, sort_keys=True))  # noqa: T201


def print_runtime() -> None:
    """The canonical identity a new server process would expose."""
    identity = static_assets.runtime_identity(static_assets.SOURCE_ROOT, static_assets.DIST_DIR)
    print(static_assets.canonical_json(identity))  # noqa: T201


def _options(arguments: Sequence[str], allowed: frozenset[str]) -> dict[str, str] | None:
    """`--name value` and `--name=value` pairs, or None for anything else."""
    options: dict[str, str] = {}
    index = 0
    while index < len(arguments):
        argument = arguments[index]
        name, separator, value = argument.partition("=")
        if name not in allowed or name in options:
            return None
        if not separator:
            index += 1
            if index >= len(arguments) or arguments[index].startswith("--"):
                return None
            value = arguments[index]
        options[name] = value
        index += 1
    return options


def main(argv: Sequence[str]) -> int | None:
    """Answer one read-only launcher question, or None to leave it to `cli`."""
    arguments = list(argv)
    if arguments == ["runtime"]:
        write_utf8()
        print_runtime()
        return 0
    if arguments[:2] == ["launcher", "status"]:
        options = _options(arguments[2:], frozenset({"--directory"}))
    elif arguments[:3] == ["launcher", "listener", "status"]:
        options = _options(arguments[3:], frozenset({"--directory", "--port"}))
    else:
        return None
    if options is None:
        return None
    try:
        if arguments[1] == "status":
            result = launcher.status(options.get("--directory"))
        else:
            port = int(options.get("--port", "8642"))
            result = launcher.listener_status(options.get("--directory"), port=port)
    except (ValueError, launcher.LauncherError):
        return None
    write_utf8()
    print_document(result)
    return 0
