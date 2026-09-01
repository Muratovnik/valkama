"""The agent-facing vocabulary of the Kernel: what a client may ask it directly.

One tool, deliberately. The Kernel answers most questions through a module's own
surface, and what an agent needs from it directly is the list of modules this
build declares — which is a read, and the only one that is not somebody else's
subject.

Here rather than in the MCP surface for the same reason Planning and
Improvements own theirs: a schema and the handler behind it are read and changed
together, and a protocol surface that carries three vocabularies makes every one
of them somebody else's business to find.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable

from . import core as platform_core

READ_ONLY = {"readOnlyHint": True, "idempotentHint": True, "openWorldHint": False}

TOOLS = [
    {
        "name": "list_platform_modules",
        "title": "List Valkama modules",
        "annotations": dict(READ_ONLY, title="List Valkama modules"),
        "description": "Return the static built-in Valkama module registry.",
        "inputSchema": {"type": "object", "properties": {}},
    },
]

OPS: dict[str, Callable[[sqlite3.Connection, dict], object]] = {
    "list_platform_modules": lambda conn, _a: platform_core.modules_payload(conn),
}

#: Derived, never restated: a hand-written second list is how a tool ends up
#: published without the gate its module is supposed to carry.
TOOL_NAMES = frozenset(OPS)
