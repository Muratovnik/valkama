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
`is_terminal`) and `claim_ref`, plus what that call changed. `revision` is the
value to pass as `expected_revision` on the next write.

| Tool | Also carries |
| --- | --- |
| `create_work_item` | `title`, `kind`, `priority` |
| `update_work_item` | `updated`, the names of the fields it edited |
| `transition_work_item` | `warnings` and `overridden` when there are any |
| `claim_work_item` | nothing more; `claim_ref` is the holder |
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
reference, or `null`) and `claim_ref`, plus `comment_hit` and `summary_hit` on a
search that matched there. Without a `limit` they return at most 50 rows, and
the answer carries `truncated`, which is true when more matched than it holds.
With `verbose: true` they answer with the full items, at the limits they had
before, and without `truncated`.

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
