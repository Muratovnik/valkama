"""The MCP stdio surface: the tool catalogue, dispatch and the message loop.

`TOOLS` is the wire contract agents read, and `_OPS` binds each tool name to the
operation that answers it. Both belong together: a tool declared without an
operation, or the reverse, is only visible when the two are read side by side.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from collections.abc import Callable
from typing import NamedTuple

from . import housekeeping, launcher, static_assets
from .ops import configuration, tray
from .planning import api as planning_api
from .planning import calls as planning_calls
from .planning import model as planning_model
from .planning import tools as planning_tools
from .platform import tools as platform_tools
from .store import connect

# --- MCP over stdio ---------------------------------------------------------

# This server is dual-era, which the specification provides for by name: one
# process may serve both revisions at once, and it picks the era from how the
# client opens rather than from configuration.
#
# `MODERN_PROTOCOL` is revision 2026-07-28, which removed the handshake. Such a
# client declares its version in `params._meta` on every request and gets
# `UnsupportedProtocolVersionError` if this build does not implement it — the
# client's whole means of recovery, since there is no handshake to renegotiate
# in.
#
# `LEGACY_PROTOCOLS` are the handshake revisions. They are kept for the clients
# that have not moved, which is no longer known to include Claude Code: a wire
# capture of 2.1.232 shows it opening with `server/discover` at the modern
# revision and never sending `initialize` at all. The board vanishing from its
# sessions twice was this file answering in the wrong envelope, not the wrong
# era. No verified client measurement establishes Codex's era, and a legacy
# client cannot fall forward, so the handshake stays until it is.
#
# There is deliberately no combined list. The two are reached through different
# doors and are never offered as one menu: `server/discover` names the modern
# revision alone, because that is what a request's `_meta` may declare, and the
# handshake versions are only selectable by performing the handshake.
MODERN_PROTOCOL = "2026-07-28"
LEGACY_PROTOCOLS = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")
PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion"
# Reserved by the specification for exactly this refusal.
UNSUPPORTED_PROTOCOL_VERSION = -32022

# Behaviour hints clients use to decide what needs confirmation. Everything here
# is local and offline, so openWorldHint is false throughout.
_OPS: dict[str, Callable[[sqlite3.Connection, dict], object]] = {
    **platform_tools.OPS,
    # The neutral vocabulary, delegating to the same boundary the HTTP surface
    # uses. A name shared with a Board tool would shadow one silently, so the
    # assertion below refuses that rather than trusting the two lists to differ.
    **planning_tools.OPS,
}

# Planning publishes one vocabulary, and it is the module's own.
_PLANNING_TOOLS = planning_tools.TOOL_NAMES

PLANNING_INSTRUCTIONS = (
    "Planned work lives in a planning space. A work item moves between the states"
    " its workflow declares; transition_work_item is how status changes, and the"
    " state names come from the workflow rather than from this text."
    " claim_work_item before starting — it is atomic, and it fails naming the"
    " holder rather than letting two agents work one item."
    " Umbrella work is kind=epic: its description bounds the scope, and children"
    " name it as parent. An item raised from a plan carries a source anchor"
    " (path#kb:xxxx) instead of a copy of the plan text."
    " claim_ready_work_item is the take-next queue: unclaimed, unblocked, and in a"
    " state work can start from."
    " Guards refuse a transition the space could not honestly report: an active"
    " state needs an executor, a terminal state needs every checklist item closed"
    " and a set_work_item_summary result, a blocked state needs a linked blocker or"
    " a stated reason. Work that is not needed, duplicated or superseded closes in"
    " the cancelled state: it needs the summary but leaves undone steps open. A"
    " refusal names its guard; force=true carries the"
    " transition through and is recorded as an overridden event."
    " Blocking is a link, not a note: add a blocks link when the blocker is another"
    " item, a comment when it is external. Work discovered en route that needs its"
    " own item is linked discovered-from; steps of one change stay on its"
    " checklist. Keep a checklist of your actual steps; when"
    " agents split it, each must claim_work_item_checklist_item by stable item_id"
    " before work and tick_work_item_checklist_item on completion, so the exact"
    " step and actor stay visible. Item and checklist claims are independent."
    " attach_work_item_ref carries commits, AgentMemory record ids materially used"
    " for the work, and your session id, so the next agent continues instead of"
    " re-deriving. Memory refs are one-way Valkama pointers; never infer or write a"
    " reverse relation inside AgentMemory."
    " Every transition, claim, takeover, release and link change is recorded with"
    " its author; get_work_item returns that history, so consult it before assuming"
    " who did what. A write answers with a short acknowledgement: the reference,"
    " the revision to pass as expected_revision on the next write, the state, the"
    " holder and what the call changed. Pass verbose=true to get the full item"
    " back instead, or read it with get_work_item."
    " Finished work reaches a terminal state; delete_work_item is"
    " only for an item that should never have existed."
)


def catalogue() -> list[dict]:
    """Every tool this process publishes.

    There is nothing left to choose. While the Board domain existed this picked
    one of two vocabularies and held the choice for the life of the process,
    because `tools/list` is answered with a cache hint promising the list cannot
    change. One domain means one list.
    """

    return [*platform_tools.TOOLS, *planning_tools.TOOLS]


# The published input schemas are the contract and they name one spelling per
# argument. After a client compacts its context the schemas are out of view, and
# agents then write the argument the way the sentence reads: `reference` for the
# item, `to` for the state. Each of those cost a refused call and a second model
# request. These names are read here, at dispatch, and nowhere below: the schemas
# do not advertise them and the domain never sees one.
_ARGUMENT_SYNONYMS: dict[str, dict[str, str]] = {
    "link_work_items": {"from": "id", "to": "other", "target": "other", "type": "kind"},
    "transition_work_item": {"to": "state", "to_state": "state"},
    "attach_work_item_ref": {"ref": "value"},
    "create_work_item": {"planning_space_id": "space"},
    "list_work_items": {"planning_space_id": "space"},
    "search_work_items": {"planning_space_id": "space"},
    "get_planning_space": {"planning_space_id": "space", "id": "space"},
}
# A tool that takes an `id` but has no argument called `ref` or `reference` of
# its own is read with those two as the item's reference; a table entry above
# wins where the same name means something else (`ref` is the value to attach).
_ITEM_SYNONYMS = {"reference": "id", "ref": "id"}

_SCHEMAS: dict[str, dict] = {tool["name"]: tool["inputSchema"] for tool in planning_tools.TOOLS}


def _synonyms(name: str) -> dict[str, str]:
    properties = _SCHEMAS[name]["properties"]
    found = (
        dict(_ITEM_SYNONYMS)
        if "id" in properties and not set(_ITEM_SYNONYMS) & set(properties)
        else {}
    )
    return {**found, **_ARGUMENT_SYNONYMS.get(name, {})}


_SYNONYMS = {name: _synonyms(name) for name in _SCHEMAS}


def _expected(name: str) -> str:
    """The names the tool takes. A tool with one argument also says what it is."""

    schema = _SCHEMAS[name]
    properties = schema["properties"]
    if not properties:
        return "expected no arguments"
    required = schema.get("required", [])
    listed = []
    for argument, definition in properties.items():
        notes = ["required"] if argument in required else []
        if len(properties) == 1 and definition.get("description"):
            notes.append(definition["description"].rstrip("."))
        listed.append(f"'{argument}'" + (f" ({': '.join(notes)})" if notes else ""))
    return "expected " + ", ".join(listed)


def _plural(names: list[str], noun: str) -> str:
    quoted = ", ".join(f"'{argument}'" for argument in names)
    return f"{noun} {quoted}" if len(names) == 1 else f"{noun}s {quoted}"


def _canonical_arguments(name: str, arguments: object) -> dict:
    """The arguments of a Planning tool under the names its schema publishes.

    A synonym is read as the canonical name when that one is absent, and a call
    that gives both with different values is refused rather than resolved by
    guessing which the caller meant. An argument the schema does not have, and
    a required one that is missing, are refused naming the tool and the names it
    does take, so a caller whose schema is out of view can correct itself in one
    call.
    """

    if not isinstance(arguments, dict):
        raise planning_api.PlanningHttpError(
            400, "invalid_request", f"{name}: arguments must be an object"
        )
    schema = _SCHEMAS[name]
    synonyms = _SYNONYMS[name]
    resolved: dict = {}
    given: dict[str, str] = {}
    unknown: list[str] = []
    for argument, value in arguments.items():
        target = argument if argument in schema["properties"] else synonyms.get(argument)
        if target is None:
            unknown.append(argument)
        elif target in resolved and resolved[target] != value:
            raise planning_api.PlanningHttpError(
                400,
                "invalid_request",
                f"{name}: '{given[target]}' and '{argument}' both set '{target}' to"
                f" different values; pass only '{target}'",
            )
        else:
            resolved.setdefault(target, value)
            given.setdefault(target, argument)
    if unknown:
        raise planning_api.PlanningHttpError(
            400,
            "invalid_request",
            f"{name}: {_plural(unknown, 'unknown argument')}; {_expected(name)}",
        )
    missing = [argument for argument in schema.get("required", []) if argument not in resolved]
    if missing:
        raise planning_api.PlanningHttpError(
            400,
            "invalid_request",
            f"{name}: {_plural(missing, 'missing argument')}; {_expected(name)}",
        )
    return resolved


def _signed(name: str, arguments: dict) -> dict:
    """A planning write that names no author is signed with the configured one.

    The client that spawned this process names itself through `VALKAMA_AUTHOR`,
    so the surface resolves that here and hands the boundary a value. Planning
    keeps its own `agent` fallback for when nothing is configured either.
    """

    if "author" not in _SCHEMAS[name]["properties"] or arguments.get("author") not in (None, ""):
        return arguments
    author = configuration.configured("author")
    return arguments if author is None else {**arguments, "author": author}


class _Client(NamedTuple):
    """What the handshake said about the client, when there was one."""

    name: str | None = None
    version: str | None = None


def _client(params: dict) -> _Client:
    info = params.get("clientInfo")
    if not isinstance(info, dict):
        return _Client()
    name, version = info.get("name"), info.get("version")
    return _Client(
        name[:200] if isinstance(name, str) and name else None,
        version[:200] if isinstance(version, str) and version else None,
    )


def call_tool(
    conn: sqlite3.Connection,
    name: str,
    arguments: dict,
    *,
    meta: object = None,
    client: _Client | None = None,
) -> object:
    """Run one tool as one call, under the identity its client proved.

    `_identity` is what a client's `PreToolUse` hook adds to every call, so it
    is taken out here, for every tool and before any schema is consulted: no
    published schema names it, and a tool refusing it would fail every call of
    a client with the hook installed. It reaches no domain code as an argument.
    """

    arguments = dict(arguments) if isinstance(arguments, dict) else arguments
    claimed = (
        arguments.pop(planning_calls.IDENTITY_ARGUMENT, None)
        if isinstance(arguments, dict)
        else None
    )
    if name not in _OPS:
        raise ValueError(f"unknown tool {name!r}")
    if name in _PLANNING_TOOLS:
        arguments = _signed(name, _canonical_arguments(name, arguments or {}))
    client = client or _Client()
    identity = planning_calls.verify_mcp(
        meta, claimed, client=client.name, client_version=client.version
    )
    with planning_calls.bind(identity, name):
        return _OPS[name](conn, arguments or {})


def _compact(payload: object) -> str:
    """A tool result as one line of JSON.

    The client is a model reading the text, and indentation is tokens it pays for
    on every call without learning anything from them.
    """

    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def _write_message(payload: dict) -> None:
    # bytes, not text: Windows text stdout would turn \n into \r\n
    sys.stdout.buffer.write((json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"))
    sys.stdout.buffer.flush()


# Appended to a tool result once this process is provably running code its
# launcher no longer starts. Written for the agent that receives it: it says what
# is wrong with the answer it just got, and the one action that fixes it.
STALE_BUILD_WARNING = (
    "WARNING: this Valkama MCP server is running code its launcher no longer"
    " starts — the source changed, or the launcher was pinned to another release,"
    " after this process started, and a client session opened now would get a"
    " different build. The result above came from the old one. Restart this"
    " client session so it spawns the current server, and treat anything"
    " surprising above as possibly stale."
)


def _unsupported_version(msg_id: object, requested: object) -> dict[str, object]:
    """The one refusal a client can act on: what it asked for, and what exists."""

    return {
        "jsonrpc": "2.0",
        "id": msg_id,
        "error": {
            "code": UNSUPPORTED_PROTOCOL_VERSION,
            "message": "Unsupported protocol version",
            "data": {"supported": [MODERN_PROTOCOL], "requested": requested},
        },
    }


# How long a client may hold the answer to `tools/list` or `server/discover`.
# Both are constants of this build: they cannot change while the process lives,
# and a new build arrives as a new process with its own client session, which
# fetches them again anyway. A short hint would therefore buy nothing but
# re-fetches of identical bytes, and there is no `listChanged` notification
# advertised here that a client could wait for instead of the clock.
CACHE_HINTS = {"ttlMs": 3_600_000, "cacheScope": "public"}


def _in_era(
    result: dict[str, object], legacy_era: str | None, *, cacheable: bool = False
) -> dict[str, object]:
    """Put an answer in the envelope its era requires.

    Revision 2026-07-28 moved `resultType` onto the base result: every result
    carries it, and `complete` is the value for one that is not asking for more
    input. The same revision requires caching hints on the results a client is
    allowed to keep -- `tools/list` and `server/discover` here. Neither omission
    is cosmetic: a modern client rejects the whole answer, which is how the tool
    list disappeared twice while the connection itself looked healthy.

    The handshake revisions define none of these fields and their clients are
    told to read an absent `resultType` as `complete`, so putting any of them
    there would state a promise those clients have no way to check.
    """

    if legacy_era is not None:
        return result
    envelope: dict[str, object] = {"resultType": "complete", **result}
    if cacheable:
        envelope.update(CACHE_HINTS)
    return envelope


def _append_stale_warning(result: dict[str, object]) -> dict[str, object]:
    """Add the warning as a further content block, never in place of the answer.

    Appended rather than prepended because `content[0]` is the payload and
    callers parse it as one.
    """

    blocks = result.get("content")
    if isinstance(blocks, list):
        blocks.append({"type": "text", "text": STALE_BUILD_WARNING})
    return result


def mcp_main() -> None:
    """Own the stdio session and its database handle."""
    conn = connect()
    try:
        # Before the first request: a lease that lapsed while no session ran
        # is released here rather than reported as held to the first reader.
        for line in housekeeping.start_up(conn):
            print(f"valkama: {line}", file=sys.stderr)  # noqa: T201
        source_watch = static_assets.SourceWatch(
            static_assets.SOURCE_ROOT, launched_from=launcher.pinned_source_reader()
        )
        _mcp_loop(conn, source_watch, catalogue())
    finally:
        conn.close()


def _mcp_loop(
    conn: sqlite3.Connection,
    source_watch: static_assets.SourceWatch,
    tools: list[dict],
) -> None:
    # The client owns this process's lifetime, so it cannot replace itself when
    # the tree moves. It can refuse to let the drift go unmentioned.
    # Which era this process ended up in, decided by the first client that says
    # so and then fixed: `None` until an `initialize` arrives, the agreed
    # handshake version afterwards. The specification scopes that choice to the
    # stdio process, and one process only ever has one client.
    legacy_era: str | None = None
    # Who the handshake said the client is; a modern client sends none.
    client = _Client()
    release_version = static_assets.release_version()
    # The tray module holds the mutex handles for as long as this session
    # does; releasing them is what lets the next session own the icon.
    tray.start()
    # Which vocabulary this process speaks, chosen with the catalogue: an
    # agent reading Board instructions while holding Planning tools is how
    # a half-finished rename reaches the client.
    instructions = PLANNING_INSTRUCTIONS
    # bytes, not text: Windows text stdin would decode requests with the locale
    # codepage, silently mojibaking every non-ASCII character into the store.
    # json.loads on bytes detects UTF-8 itself, same as the desktop HTTP path.
    for raw in sys.stdin.buffer:
        if not raw.strip():
            continue
        try:
            message = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        if not isinstance(message, dict):
            # A frame that parses but is not a request object is skipped like
            # unparseable bytes. A malformed frame from any client or adapter
            # must not end the session: reaching `.get` on a list would raise
            # out of the loop and take the whole process with it.
            continue
        method = message.get("method")
        msg_id = message.get("id")
        sent_params = message.get("params")
        params = sent_params if isinstance(sent_params, dict) else {}
        if method == "server/discover":
            # Answered whatever version the caller asked for, including none and
            # including one this build has never heard of. Discovery is how a
            # client finds out which versions exist, so refusing it over the
            # version it is trying to discover would be a closed loop.
            _write_message(
                {
                    "jsonrpc": "2.0",
                    "id": msg_id,
                    "result": {
                        "resultType": "complete",
                        **CACHE_HINTS,
                        # Only the modern revision: this list is what a client
                        # may put in a request's `_meta`, and the handshake
                        # versions are not reachable that way. They are a
                        # different door, opened by `initialize`, not a choice
                        # offered here.
                        "supportedVersions": [MODERN_PROTOCOL],
                        "capabilities": {"tools": {}},
                        "instructions": instructions,
                        "_meta": {
                            # Build metadata, not decoration: the release number
                            # alone was a literal that never moved, so two
                            # servers from different checkouts introduced
                            # themselves identically and nothing downstream
                            # could tell them apart.
                            "io.modelcontextprotocol/serverInfo": {
                                "name": "valkama",
                                "version": f"{release_version}+{source_watch.build_id}",
                            }
                        },
                    },
                }
            )
            continue
        if method == "initialize":
            # An `initialize` puts this process in the legacy era for the rest
            # of its life, which is the scope the specification gives a stdio
            # server. Claude Code is such a client today: it opens with this and
            # has no way to fall forward, so answering it is the difference
            # between a working board and a red entry in its server list.
            wanted = params.get("protocolVersion")
            legacy_era = wanted if wanted in LEGACY_PROTOCOLS else LEGACY_PROTOCOLS[0]
            client = _client(params)
            if msg_id is not None:  # a notification cannot be answered
                _write_message(
                    {
                        "jsonrpc": "2.0",
                        "id": msg_id,
                        "result": {
                            "protocolVersion": legacy_era,
                            "capabilities": {"tools": {}},
                            "serverInfo": {
                                "name": "valkama",
                                "version": f"{release_version}+{source_watch.build_id}",
                            },
                            "instructions": instructions,
                        },
                    }
                )
            continue
        if legacy_era is None:
            # No handshake has happened, so this is a modern request and carries
            # its own version. A notification cannot be answered, so a
            # wrong-version notification is dropped rather than reported.
            meta = params.get("_meta")
            version = meta.get(PROTOCOL_VERSION_KEY) if isinstance(meta, dict) else None
            if version != MODERN_PROTOCOL:
                if msg_id is not None:
                    _write_message(_unsupported_version(msg_id, version))
                continue
        if method == "tools/list":
            _write_message(
                {
                    "jsonrpc": "2.0",
                    "id": msg_id,
                    "result": _in_era({"tools": tools}, legacy_era, cacheable=True),
                }
            )
        elif method == "tools/call":
            try:
                data = call_tool(
                    conn,
                    params.get("name", ""),
                    params.get("arguments") or {},
                    meta=params.get("_meta"),
                    client=client,
                )
                # The write has to be committed here. Board operations committed
                # inside themselves; the Planning service leaves the transaction
                # to its caller, so without this every tool write an agent made
                # was rolled back when the process ended.
                conn.commit()
                content = _compact(data)
                result = {"content": [{"type": "text", "text": content}], "isError": False}
            except planning_model.PlanningError as error:
                # A guard refusal and a stale write are answers, not crashes, so
                # they carry the same structured body the HTTP boundary sends.
                conn.rollback()
                payload = planning_api.error_response(error)[1]
                result = {
                    "content": [{"type": "text", "text": _compact(payload)}],
                    "structuredContent": payload,
                    "isError": True,
                }
            except Exception as error:
                conn.rollback()
                result = {
                    "content": [{"type": "text", "text": f"{type(error).__name__}: {error}"}],
                    "isError": True,
                }
            if source_watch.drifted():
                result = _append_stale_warning(result)
            _write_message({"jsonrpc": "2.0", "id": msg_id, "result": _in_era(result, legacy_era)})
        elif method == "ping":
            _write_message({"jsonrpc": "2.0", "id": msg_id, "result": _in_era({}, legacy_era)})
        elif msg_id is not None:
            _write_message(
                {
                    "jsonrpc": "2.0",
                    "id": msg_id,
                    "error": {"code": -32601, "message": f"method not supported: {method}"},
                }
            )
