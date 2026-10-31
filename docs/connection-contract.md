---
status: adopted
card: 344
---

# The connection contract

What a client learns when it connects to this server, and how the server keeps a
stale build from answering as if it were current. Two topics, one subject: the
process on the other end of the pipe, and whether you can trust what it says.

## Two eras on one pipe

This server is **dual-era**. One process serves MCP revision **2026-07-28** and
the `initialize` handshake that revision replaced, and it picks which from how
the client opens rather than from configuration. The specification provides for
that arrangement by name.

- A request carrying `params._meta` with
  `io.modelcontextprotocol/protocolVersion` is **modern**. There is no session:
  each request is accepted or refused on the version it declares.
- An `initialize` puts the process in the **legacy** era for the rest of its
  life — the scope the specification gives a stdio server. After that, requests
  carry no version of their own, because a client that old never learned to send
  one.

### `server/discover`

`server/discover` answers what this server is — supported versions,
capabilities, identity and `instructions` — in one round trip, replacing what
the handshake used to carry.

It is the one request never refused over its version. A client asks it precisely
when it does not yet know what to speak, so refusing it for asking would close
the loop it exists to open.

It offers only the modern revision, since that is what a request's `_meta` may
name. The handshake versions are a different door, not another item on this
list.

A modern request naming a version this build does not implement is refused with
`UnsupportedProtocolVersionError` (`-32022`). Its `data` carries both what was
asked for and what exists — with no handshake to renegotiate in, that is the
client's whole means of recovery.

### Fields a result must carry

Every modern result carries `resultType`. The two results a client may cache —
`tools/list` and `server/discover` — carry `ttlMs` and `cacheScope` as well.

The revision requires both, and a client that does not get them discards the
answer while the connection still looks healthy. That, not the era, is what made
the Planning tools vanish from Claude Code twice. A legacy answer carries
neither, because those revisions never defined them.

### When the legacy door closes

It stays open for clients that have not moved. That is no longer known to
include Claude Code — a wire capture shows it opening with `server/discover`.

The door closes when nothing knocks on it, and that is established by recording
what a client actually sends, not by reading its changelog.

### Tools

Every tool carries a `title`, a description, a JSON Schema, and MCP behaviour
`annotations`. There are three sets:

| Set | `readOnlyHint` | `destructiveHint` | `idempotentHint` | Tools |
| --- | --- | --- | --- | --- |
| read-only | `true` | — | `true` | the reading tools: `list_planning_spaces`, `get_planning_space`, `get_work_item`, `list_work_items`, `search_work_items`, `list_platform_modules` |
| writing | `false` | `false` | — | everything else |
| destructive | `false` | `true` | — | `delete_work_item` |

`openWorldHint` is `false` throughout, because nothing here leaves the machine.

### Tool results

A tool result is one line of JSON text, without indentation.

A write to a work item answers with a short acknowledgement instead of the whole
item: `reference`, `work_item_id`, `revision`, `state` (`key`, `name`,
`is_terminal`), `claim_ref` and `claim_state`, plus what that call changed.
`revision` is the value to pass as `expected_revision` on the next write.
`claim_state` is the holder's lease, described in
[Claims are leases](#claims-are-leases).

| Tool | Also carries |
| --- | --- |
| `create_work_item` | `title`, `kind`, `priority` |
| `update_work_item` | `updated`, the names of the fields it edited |
| `transition_work_item` | `warnings` and `overridden` when there are any |
| `claim_work_item` | nothing more; `claim_ref` is the holder and `claim_state` its lease |
| `set_work_item_checklist` | `checklist`, the new steps as `item_id` and `text` |
| `claim_work_item_checklist_item`, `tick_work_item_checklist_item` | `step`: `item_id`, `done`, `claimed_by`, `done_by` |
| `set_work_item_summary` | `summary_recorded: true` |

Each of these tools takes an optional boolean `verbose`, false by default. With
`verbose: true` the answer is the full item that `get_work_item` returns. The
reads, `claim_ready_work_item` (the agent needs the item it just took),
`create_planning_space`, `delete_work_item` and the tools that already answer
briefly (`link_work_items`, `attach_work_item_ref`, `comment_work_item`) are
unchanged, and so is every refusal. The HTTP API is unchanged: it always
answers with the full item.

`list_work_items` and `search_work_items` answer one compact row per item:
`reference`, `title`, `kind`, `state` (the key), `priority`, `parent` (a
reference, or `null`), `claim_ref` and `claim_state`, plus `comment_hit` and
`summary_hit` on a search that matched there. Without a `limit` they return at most 50 rows.

Each answer is one page. `truncated` is true when more items match than the page
holds, and `next_offset` is then the offset of the next page; on the last page
it is `null`. A page holds at most 1000 items for `list_work_items` and 200 for
`search_work_items`. A larger `limit` is answered with at most one page, and
`truncated` still says whether more items match. Both tools take an optional
`offset`, a non-negative integer, 0 by default. Calling again with the same
filters and each `next_offset` until it is `null` returns every matching item
exactly once, as long as nothing writes to the store in between; a write between
two pages can move an item across the boundary. An `offset` that is negative or
not an integer is refused with `invalid_request`.

A refused MCP tool call answers with `isError: true` and the same body the HTTP
API sends, both as the text content and as `structuredContent`:
`{"error": {"code": "...", "message": "..."}}`. That holds for a refused
argument (an unknown one, a missing one, a `limit` or `offset` that is not an
integer: `invalid_request`) as much as for a guard refusal or a stale write.

With `verbose: true` they answer with the full items, at the limits they had
before (200 for a list, 50 for a search), and with the same `truncated` and
`next_offset`. The HTTP reads `GET /api/planning/work-items` and
`GET /api/planning/search` take the same `offset` parameter and carry the same
two fields.

### Argument names

The published schemas name one spelling for each argument. A Planning tool also
reads a few other spellings, because a caller that no longer has the schema in
view writes the argument the way it would say it: `reference` or `ref` for an
`id`; for `link_work_items`, `from`, `to`, `target` and `type` for `id`,
`other`, `other` and `kind`; `to` or `to_state` for the `state` of
`transition_work_item`; `ref` for the `value` of `attach_work_item_ref`; and
`planning_space_id` for the `space` of `create_work_item`, `list_work_items`,
`search_work_items` and `get_planning_space` (which also reads `id`). The
canonical name is used when both are given with the same value. Both given with
different values is refused. The schemas do not list these spellings, and
nothing below the MCP surface reads them.

A Planning tool refuses an argument its schema does not have, and a required
argument that is missing, naming the tool, the argument and the arguments the
tool takes, for example `get_work_item: unknown argument 'item'; expected 'id'`.

Prompts and resources are deliberately not offered. Planning tools manage work;
project context belongs elsewhere.

### Call identity

Every Planning write call records who made it: one row in the execution tree
per call, which every event, comment and ref the call writes points to. The row
is `confirmed` when the client proved the session, and `unconfirmed` otherwise.
An unconfirmed call is still accepted and runs exactly as before. The `author`
argument is text the caller writes about itself and is never identity, and
neither is the environment of the server process.

The server reads identity from the request, not from the arguments a model
writes:

| Client sends | Result | `source` |
| --- | --- | --- |
| `params._meta.sessionId` (Codex) | `confirmed`. The session is `sessionId`; the agent is `_meta.threadId` when it differs from `sessionId` (a subagent's own thread); `_meta.callId` is kept as the tool use id. | `codex-meta` |
| the same, with an `_identity` argument that names another session, call or agent | `unconfirmed`, with the session from `_meta` | `codex-meta-mismatch` |
| an `_identity` argument whose `tool_use_id` equals `params._meta["claudecode/toolUseId"]` (Claude Code) | `confirmed`, with the session and agent from `_identity` | `claude-hook` |
| an `_identity` argument and no `claudecode/toolUseId` in `_meta` | `unconfirmed`, with the session and agent from `_identity` | `claude-hook-unverified` |
| an `_identity` argument whose `tool_use_id` differs from `claudecode/toolUseId` | `unconfirmed`, with the session and agent from `_identity` | `claude-hook-mismatch` |
| none of these | `unconfirmed`, no session | `mcp` |

A model cannot know the id of the call it is about to make, so a matching
`tool_use_id` is what tells an `_identity` added by a client hook from one the
model typed. Neither `_meta` key is documented by its client; both are checked,
never assumed.

`_identity` is the argument a client's `PreToolUse` hook adds to every call of
this server:

```json
{"session_id": "<hook session id>", "tool_use_id": "<hook tool use id>", "agent_id": "<optional>", "agent_type": "<optional>"}
```

Each value is a string of at most 200 characters, and other keys are ignored.
The server removes `_identity` from the arguments of every tool, reads included,
before it checks them against the tool's schema, so no tool refuses it and no
handler sees it. No published input schema names it, and `tools/list` is the
same with or without a hook. An `_identity` that does not match this shape is
dropped: the call runs and is recorded as if it carried none.

When the client opened with `initialize`, the `clientInfo` name and version it
sent are recorded with each call; otherwise the client is named after the
identity channel (`codex`, `claude`). Nothing else from `_meta` is stored.

`get_work_item`, and a write with `verbose: true`, answer every history event
with its call's identity:

```json
{"action": "claimed", "detail": "", "author": "codex", "at": "2026-10-31T09:00:00Z",
 "identity": {"state": "confirmed", "source": "codex-meta", "session_id": "019a…", "agent_id": null}}
```

An event written before calls were recorded, or by the execution runner outside
any call, has
`{"state": "unconfirmed", "source": null, "session_id": null, "agent_id": null}`.
A write from the browser UI is `confirmed` with source `browser` and no session;
see [Local HTTP security](../README.md#local-http-security). A write Valkama
makes on its own account, which today is only releasing an expired lease, is
`confirmed` with source `valkama`, client `valkama` and tool `lease-expiry`, and
its events are signed `valkama`.

A confirmed call with a session is also a sign of life of that session. The
first write of the call moves `last_seen` of the session row forward, creating
the row when it is missing, exactly as a hook event does. Inside a subagent the
call names its parent session, and the parent's row is the one that moves. A
session whose row says `ended` before the call arrived was resumed by its
client without a new session start, so the call makes it `active` again and its
claims stay live. A `failed` session stays failed until a session start.

### Claims are leases

A claim records the call that took it, and through that call the session that
holds the item. Whether that session is still there is computed at every read
and never written by one:

| Checked in order | `claim_state` |
| --- | --- |
| nobody holds the item | `null` |
| the claim names no call, the call is not `confirmed`, or it has no session | `unconfirmed` |
| the session has no row, is `ended` or `failed`, or was last seen more than 14 days ago | `stale` |
| otherwise | `live` |

A claim made before calls were recorded, by a build that does not record them,
or in the browser reads `unconfirmed`: none of them names a session.

`get_work_item`, a `verbose` write and the HTTP item read carry the lease as
`claim`:

```json
{"holder": "codex", "state": "live", "session_id": "019a…", "agent_id": null,
 "source": "codex-meta", "acquired_at": "2026-10-31T09:00:00.120Z",
 "last_seen": "2026-10-31T09:40:12Z", "expires_at": "2026-11-14T09:40:12Z"}
```

`holder` is `claim_ref`. `acquired_at` is when the claiming call arrived and is
`null` for a claim that names no call; `last_seen` is the session's, and
`expires_at` is `last_seen` plus 14 days while the lease is `live`, `null`
otherwise. `claim` is `null` when nobody holds the item. Every item record, full
or listed, carries `claim_state`; `claim_ref` and `ready` mean what they meant.

Who may release or take over a claim follows the lease:

- A call from the session that holds a `live` or `stale` lease is the holder,
  whatever `author` it signs with and whichever of its subagents makes it.
- Any other call needs `force` against a `live` lease, including a call from
  another session that signs with the same `author`, and a call with no
  confirmed session at all.
- A `stale` lease is released by the first write that meets it, before that
  write does anything else: `claim_work_item` on that item, and
  `claim_ready_work_item`, which first releases every stale lease in its space.
  The release is a `released` event with the detail `lease-expired: <holder>`,
  written by Valkama under its own call. Taking a stale claim over therefore
  needs no `force`, and its history reads `released` and then `claimed`.
  `claim_work_item` with `release` on a stale lease stops after that release.
- An `unconfirmed` claim is compared by `author`, as every claim was before
  leases, and never expires by itself.

An MCP server and `serve` also release every stale lease once when they start.

The space's list of abandoned claims (`stale_claims` in the read model) holds
every `stale` lease and every `unconfirmed` claim with no event for three days,
except the owner's own claim made in the browser. A claim a launch took for its
runner is listed like any other.

A claim still counts as the executor that starting an item requires. Starting
an item under an `unconfirmed` or a `stale` claim answers with a warning, not a
refusal, unless the claim was taken in the browser.

### Questions and decisions

`create_work_item_request` creates a persistent question or decision for one work
item. `get_work_item_request` and `list_work_item_requests` are read-only tools.
The answer, decline and expire tools take the request's own `expected_revision`;
it is independent of the work item revision. Only one concurrent resolution can
succeed. A closed task, ended bound execution or elapsed deadline prevents a
late answer. Reading effective expiry does not write to an attached store.

Fields have stable IDs and one of four types: `text`, `choice`, `multi_choice`
or `boolean`. A required boolean can be answered `false`; omission is different.
There is no implicit permission grant or automatic execution resume.

The browser's mapped search and request endpoints return exact project and
Planning-space identities. Their list envelopes include source coverage and a
truncation flag. A request detail or mutation returns the confirmed request with
its target; attached stores remain read-only. Existing Planning searches and
the complete space read model keep their existing scope and limits.

### Server identity

The `serverInfo` in the discovery result reports version `1.0.0+<build>`, where
the build is the first twelve hex characters of a digest over the modules the
process started with.

The release number alone was a literal that had never moved, so two servers from
different checkouts introduced themselves identically.

## Running one version against another's data

A stdio MCP server is spawned by its client from a working tree, and lives as
long as the session does. Nothing makes it exit when that tree changes.

So pulling a change gives the *next* session a process built from the new code
while the current one keeps answering from the old — both against the same
store. No automatic update can fix this: the client owns the process, and a
server that killed itself mid-call would lose the call rather than repair
anything.

Two guards make the skew impossible to miss instead.

### A process that went stale while it ran

`static_assets.SourceWatch` covers this case. Every tool result from such a
process carries an extra content block saying so and naming the one fix:
restart the client session.

It is appended, never prepended — `content[0]` stays the payload.

The check is two signals, so it can be asked on every call. A stat-only stamp
says something *may* have happened; only then are the modules read to see
whether anything did. A `git checkout` that restores identical bytes is
therefore not reported as a change.

Drift is one-way. A process cannot become current again.

### A build that was already old when it started

`store.STORE_SCHEMA_VERSION` covers the opposite case: a checkout moved back, an
installed copy left behind.

The generation lives in `PRAGMA user_version` and is read before the first
write of any kind, including the schema script. A store written by a newer build raises
`StoreTooNew` and is not touched.

Raise the number in the same commit that changes what an existing row *means*.
Migrations here are forward-only and idempotent, so it is the change of meaning,
not an added column, that this exists to stop.
