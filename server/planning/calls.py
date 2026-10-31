"""Who made a Planning write call, and the one execution-tree row that says so.

A write call is one MCP tool call or one HTTP write. Each gets exactly one row in
`execution_events` (`kind = 'planning_write'`), and every Planning row the call
writes points at it through `call_id`. Identity lives there once, not copied onto
each event, comment or ref, and a write that logs no event — an edit, a ref, a
comment — still has its row.

The surface knows who is calling and the domain knows when it writes, so the two
meet through `bind`: the surface binds the call's identity for the duration of
the call, and the first write that needs `call_id` inserts the row. The row rides
the call's own transaction, so a refused call leaves none. A context variable is
what carries it rather than a parameter on every verb, because the tool table
and the runner reach the same verbs without passing one; it is per thread, which
is what the threaded HTTP listener needs.

A write made outside any bound call — the execution runner in the background —
writes `call_id` NULL and reads exactly like history written before identity
existed: unconfirmed.

Verification is a pure function of what the client sent. Codex puts the session
in `_meta` of every call. Claude Code gets it into the call through a
`PreToolUse` hook that adds an `_identity` argument; what tells that argument
from one the model typed is that the hook also knows the call's `tool_use_id`,
which Claude Code repeats in `_meta["claudecode/toolUseId"]` and a model cannot
know in advance. Neither key is documented, so each is an input to check, never
an assumption. The server's own environment and the free-text `author` are
never identity.
"""

from __future__ import annotations

import contextlib
import contextvars
import hashlib
import re
import sqlite3
import uuid
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime

from .. import sessions
from . import model

KIND = "planning_write"

CONFIRMED = "confirmed"
UNCONFIRMED = "unconfirmed"
#: The values `identity_state` takes. Code constants rather than a CHECK: a
#: widened CHECK means rebuilding the table under a snapshot.
STATES = (CONFIRMED, UNCONFIRMED)

#: Codex: a non-empty `_meta.sessionId`.
CODEX_META = "codex-meta"
#: Codex: `_meta.sessionId`, but an `_identity` argument that disagrees with it.
CODEX_META_MISMATCH = "codex-meta-mismatch"
#: Claude Code: `_identity` whose `tool_use_id` equals `_meta["claudecode/toolUseId"]`.
CLAUDE_HOOK = "claude-hook"
#: Claude Code: `_identity`, but no `claudecode/toolUseId` in `_meta` to check it against.
CLAUDE_HOOK_UNVERIFIED = "claude-hook-unverified"
#: `_identity` whose `tool_use_id` differs from `_meta["claudecode/toolUseId"]`.
CLAUDE_HOOK_MISMATCH = "claude-hook-mismatch"
#: An MCP call that carried nothing verifiable.
MCP = "mcp"
#: An authorized browser write: the owner's own UI.
BROWSER = "browser"
#: A command-line write. Reserved: no command writes Planning today.
CLI = "cli"
#: A write Valkama makes itself: releasing a lease that expired.
VALKAMA = "valkama"
#: The values `identity_source` takes on a call row.
SOURCES = (
    CODEX_META,
    CODEX_META_MISMATCH,
    CLAUDE_HOOK,
    CLAUDE_HOOK_UNVERIFIED,
    CLAUDE_HOOK_MISMATCH,
    MCP,
    BROWSER,
    CLI,
    VALKAMA,
)

#: The argument a `PreToolUse` hook adds. Removed before schema validation.
IDENTITY_ARGUMENT = "_identity"
#: Who signs a browser write that names no author: the owner.
OWNER_ACTOR = "user"

_CLAUDE_TOOL_USE = "claudecode/toolUseId"
#: Longest identifier accepted from a client; anything longer is not an id.
_ID_LIMIT = 200


@dataclass(frozen=True)
class Identity:
    """What a call proved, or claimed, about who made it."""

    state: str
    source: str
    session_id: str | None = None
    agent_id: str | None = None
    agent_type: str | None = None
    tool_use_id: str | None = None
    client: str | None = None
    client_version: str | None = None


@dataclass
class _Call:
    identity: Identity
    tool: str
    #: Found again by this on every write rather than cached as a row id: a
    #: savepoint rolled back mid-call can take the row with it.
    event_uid: str = field(default_factory=lambda: str(uuid.uuid4()))


_CURRENT: contextvars.ContextVar[_Call | None] = contextvars.ContextVar(
    "valkama_planning_call", default=None
)


def _text(value: object) -> str | None:
    """A client-supplied identifier, or None when it is not one."""

    if isinstance(value, str) and 0 < len(value) <= _ID_LIMIT and "\x00" not in value:
        return value
    return None


def identity_argument(value: object) -> dict[str, str] | None:
    """The hook's `_identity` object, or None when it is malformed.

    The contract is `{"session_id", "tool_use_id", "agent_id"?, "agent_type"?}`,
    each a string. Anything else in it is ignored. A malformed one is dropped,
    never refused: the call is still the caller's work, only unconfirmed.
    """

    if not isinstance(value, Mapping):
        return None
    session_id = _text(value.get("session_id"))
    tool_use_id = _text(value.get("tool_use_id"))
    if session_id is None or tool_use_id is None:
        return None
    found = {"session_id": session_id, "tool_use_id": tool_use_id}
    for optional in ("agent_id", "agent_type"):
        if optional in value and value[optional] is not None:
            text = _text(value[optional])
            if text is None:
                return None
            found[optional] = text
    return found


def verify_mcp(
    meta: object,
    argument: object,
    *,
    client: str | None = None,
    client_version: str | None = None,
) -> Identity:
    """The identity of one MCP tool call, from its `_meta` and stripped `_identity`.

    `client` is what the handshake named, when there was one; otherwise the
    channel the identity came through names it.
    """

    meta = meta if isinstance(meta, Mapping) else {}
    claimed = identity_argument(argument)
    session_id = _text(meta.get("sessionId"))
    if session_id is not None:
        thread_id = _text(meta.get("threadId"))
        agent_id = thread_id if thread_id is not None and thread_id != session_id else None
        call_id = _text(meta.get("callId"))
        agrees = claimed is None or (
            claimed["session_id"] == session_id
            and (call_id is None or claimed["tool_use_id"] == call_id)
            and claimed.get("agent_id", agent_id) == agent_id
        )
        return Identity(
            state=CONFIRMED if agrees else UNCONFIRMED,
            source=CODEX_META if agrees else CODEX_META_MISMATCH,
            session_id=session_id,
            agent_id=agent_id,
            agent_type=claimed.get("agent_type") if claimed else None,
            tool_use_id=call_id,
            client=client or "codex",
            client_version=client_version,
        )
    tool_use = _text(meta.get(_CLAUDE_TOOL_USE))
    if claimed is not None:
        if tool_use is None:
            state, source = UNCONFIRMED, CLAUDE_HOOK_UNVERIFIED
        elif claimed["tool_use_id"] == tool_use:
            state, source = CONFIRMED, CLAUDE_HOOK
        else:
            state, source = UNCONFIRMED, CLAUDE_HOOK_MISMATCH
        return Identity(
            state=state,
            source=source,
            session_id=claimed["session_id"],
            agent_id=claimed.get("agent_id"),
            agent_type=claimed.get("agent_type"),
            tool_use_id=tool_use if tool_use is not None else claimed["tool_use_id"],
            client=client or "claude",
            client_version=client_version,
        )
    return Identity(
        state=UNCONFIRMED,
        source=MCP,
        tool_use_id=tool_use,
        client=client or ("claude" if tool_use is not None else None),
        client_version=client_version,
    )


def browser() -> Identity:
    """An authorized browser write: the owner's UI, with no agent session behind it."""

    return Identity(state=CONFIRMED, source=BROWSER, client=BROWSER)


def valkama() -> Identity:
    """A write Valkama makes on its own account, such as releasing an expired lease."""

    return Identity(state=CONFIRMED, source=VALKAMA, client=VALKAMA)


@contextlib.contextmanager
def bind(identity: Identity, tool: str) -> Iterator[None]:
    """Make every Planning write inside this block part of one call."""

    token = _CURRENT.set(_Call(identity, tool))
    try:
        yield
    finally:
        _CURRENT.reset(token)


def default_author() -> str | None:
    """Who signs a write that names no author, when the call itself says.

    A browser write is the owner's, so it is signed `user`. Anything else
    leaves the choice to Planning's own fallback.
    """

    call = _CURRENT.get()
    return OWNER_ACTOR if call is not None and call.identity.source == BROWSER else None


def current() -> Identity | None:
    """The identity of the call in progress, or None outside any call."""

    call = _CURRENT.get()
    return call.identity if call is not None else None


#: The name a holder opens with, by the channel that proved the session. Named
#: after the channel rather than the handshake's `clientInfo`, so one client
#: reads the same whether or not it opened with `initialize`.
_CHANNEL_NAMES = {CODEX_META: "codex", CLAUDE_HOOK: "claude"}
#: An identifier a holder carries as it is: what both clients send today.
_PLAIN_ID = re.compile(r"^[A-Za-z0-9._:-]{1,40}$")


def holder(author: str | None) -> str:
    """Who this call is, as a claim or a checklist step records its holder.

    A call whose client proved its session holds as that session, whatever
    `author` it signs with: `codex (session 019a…)`, and inside a subagent
    `claude agent a7 (session 5937…)`. Agents used to sign claims as `claude`,
    `claude-code`, `agent` or a name of their own, so two sessions read as one
    holder and one session as several. Any other call — no identity, an
    unconfirmed one, the browser, the runner — holds by its `author`, as every
    claim did before.

    The label is text in `claim_ref` and `claimed_by`, so an earlier build reads
    it as the name it always held. `name (session id)` is also the spelling the
    web already parses into a name and a session.
    """

    identity = current()
    name = _CHANNEL_NAMES.get(identity.source) if identity is not None else None
    if (
        identity is None
        or name is None
        or identity.state != CONFIRMED
        or identity.session_id is None
    ):
        return model.actor(author)
    if identity.agent_id is not None:
        name += f" agent {_label_id(identity.agent_id)}"
    return f"{name} (session {_label_id(identity.session_id)})"


def _label_id(value: str) -> str:
    """An id as a holder carries it: itself, or a short digest of one that is not plain.

    The digest keeps a label inside the 128 characters a holder may have and
    free of anything a name may not hold, without letting two ids collide.
    """

    if _PLAIN_ID.match(value):
        return value
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


def call_id(conn: sqlite3.Connection, work_item_id: str | None) -> int | None:
    """The row of the call in progress, inserted by its first write; None outside a call.

    `work_item_id` is what the call acted on, recorded only by the write that
    inserts the row: a link names its source item first.
    """

    call = _CURRENT.get()
    if call is None:
        return None
    found = conn.execute(
        "SELECT id FROM execution_events WHERE event_uid = ?", (call.event_uid,)
    ).fetchone()
    if found is not None:
        return int(found[0])
    identity = call.identity
    inserted = conn.execute(
        "INSERT INTO execution_events(event_uid,kind,identity_state,identity_source,client,"
        "client_version,tool,session_id,agent_id,agent_type,tool_use_id,work_item_id)"
        " VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            call.event_uid,
            KIND,
            identity.state,
            identity.source,
            identity.client,
            identity.client_version,
            call.tool,
            identity.session_id,
            identity.agent_id,
            identity.agent_type,
            identity.tool_use_id,
            work_item_id,
        ),
    )
    _heartbeat(conn, identity)
    return int(inserted.lastrowid or 0)


def _heartbeat(conn: sqlite3.Connection, identity: Identity) -> None:
    """Count a confirmed call as a sign of life of the session that made it.

    A client proved the session, so the session is working, whether or not its
    hooks reported anything: without this, an agent whose hooks are silent
    would watch its own lease lapse while it writes. The call names the
    top-level session even inside a subagent, and that row is the one a lease
    follows. A missing row is created, as a hook event would. A session that
    ended before this call was resumed by its client, so it is active again.
    """

    if identity.state != CONFIRMED or identity.session_id is None:
        return
    at = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    if sessions.touch(conn, identity.session_id, client=identity.client or "", at=at):
        # A call made now, after the session's end, is that session resumed.
        sessions.resume(conn, identity.session_id, at=at)


def acted_on(result: object) -> str | None:
    """The work item a write's answer names, for a call no write recorded yet."""

    if not isinstance(result, Mapping):
        return None
    for candidate in (result, result.get("work_item"), result.get("request")):
        if isinstance(candidate, Mapping) and isinstance(candidate.get("work_item_id"), str):
            return str(candidate["work_item_id"])
    return None
