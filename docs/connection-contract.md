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
| read-only | `true` | — | `true` | the reading tools: `list_planning_spaces`, `get_planning_space`, `get_work_item`, `get_work_item_chain`, `list_work_items`, `search_work_items`, `list_platform_modules` |
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
| `create_work_item` | `title`, `kind`, `priority`; `applied` when it took `claim` or `links` |
| `update_work_item` | `updated`, the names of the fields it edited |
| `transition_work_item` | `warnings` and `overridden` when there are any |
| `claim_work_item` | nothing more; `claim_ref` is the holder and `claim_state` its lease |
| `set_work_item_checklist` | `checklist`, the new steps as `item_id` and `text` |
| `claim_work_item_checklist_item`, `tick_work_item_checklist_item` | `step`: `item_id`, `done`, `claimed_by`, `done_by` |
| `set_work_item_summary` | `summary_recorded: true` |
| `apply_work_item_changes` | `applied`, what each group changed; `warnings` and `overridden` from its transition when there are any |

Each of these tools takes an optional boolean `verbose`, false by default. With
`verbose: true` the answer is the full item with its whole history, as
`get_work_item` returns it with `full: true` but without `sessions`. The
reads, `claim_ready_work_item` (the agent needs the item it just took),
`create_planning_space`, `delete_work_item` and the tools that already answer
briefly (`link_work_items`, `attach_work_item_ref`, `comment_work_item`) are
unchanged, and so is every refusal. The HTTP API is unchanged: it always
answers with the full item.

`list_work_items` and `search_work_items` answer one compact row per item:
`reference`, `title`, `kind`, `state` (the key), `priority`, `parent` (a
reference, or `null`), `claim_ref` and `claim_state`, plus `comment_hit` and
`summary_hit` on a search that matched there. Without a `limit` they return at most 50 rows.
A search whose query is exactly a work-item reference -- `MAIN-12`, in any
case, with surrounding spaces ignored -- answers that item first; every other
match keeps its order, most recently changed first.
`list_work_items` also takes `parent`, a work item by reference or id, and then
lists only that item's children; the HTTP read `GET /api/planning/work-items`
takes the same `parent` parameter. An unknown `parent` is refused with
`invalid_request`.

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

### The order of work

Every work item has a place among the items in its state, and that place is the
order work is taken in. `list_work_items`, `GET /api/planning/work-items` and
`GET /api/planning` list the items of each state in that order, the states in
the workflow's order. The place is the item's `position`, which every store
already holds, so placing an item changes no store format and a build that
predates placements reads the same order.

`update_work_item` and `POST /api/planning/work-item/update` take `rank`, which
places the item among the items of its own state:

| `rank` | Places the item |
| --- | --- |
| `first` | before every other item in its state |
| `last` | after every other item in its state |
| `before:<item>` | directly before that item |
| `after:<item>` | directly after that item |

`<item>` is a reference or a work item id, and it must be another item in the
same state of the same planning space. Any other spelling, and an anchor that is
the item itself, lives in another space or stands in another state, is refused
with `invalid_request` before anything is written. A placement that names where
the item already stands writes nothing. Otherwise it is an edit like the other
fields `update_work_item` takes: guarded by `expected_revision`, one revision,
no history event, and the acknowledgement's `updated` names `rank`. The call is
recorded with its identity, as every write is. Placing an item moves no other
item, except when two neighbours leave no room between them: then the items of
that state are renumbered in the order they already have, with no revision bump.

`transition_work_item`, `POST /api/planning/work-item/transition` and the
`transition` group of `apply_work_item_changes` take the same `rank`, which
places the item in the state it moves to; the anchor must then be in that state.
Without `rank` a moved item goes last in its new state, as it did before
placements existed, and a new item goes last in its first state.

`claim_ready_work_item` takes the first ready item in that order: an item in a
`queued` state before one in a `backlog` state, then the states in the
workflow's order, then the place inside the state. Priority only breaks a tie
between two items at the same place, which a store written before placements
can hold, and the item number breaks what is left. Placing an item first is what
makes it next; an urgent item nobody placed waits its turn.

### Reading one work item

`get_work_item` answers with every current field of the item -- state,
checklist, links, refs, summary, the lease -- but only the newest part of its
history: the 5 most recent comments and the 10 most recent history events,
oldest first. Beside them it carries `comments_total`, `events_total` and
`history_truncated`, which is true when either list left something out. With
the optional boolean `full: true` it answers with every comment and every
event, and without the three counting fields.

Both forms carry `sessions`: the agent sessions whose confirmed calls wrote to
the item, in the order each first wrote there.

```json
{"session_id": "019a…", "client": "codex", "identity_source": "codex-meta",
 "first_at": "2026-10-31T09:00:00.120Z", "last_at": "2026-10-31T09:40:12.004Z", "writes": 4}
```

Only a `confirmed` call with a session counts, so an unconfirmed call, a browser
write and a write Valkama makes itself are not listed. `client` and
`identity_source` are those of the session's latest call there, and `writes`
counts its calls. A call is counted on the item it acted on first: a link counts
for its source item, not its target. Because Valkama records this itself, a
caller does not attach its own session id as a ref.

The HTTP read `GET /api/planning/work-item` answers with the complete record and
no `sessions`, as before. It takes the same cut as opt-in parameters:
`comments` and `events` (non-negative integers, each keeping that many of the
newest entries) and `sessions=true`. A count that is not a non-negative integer
and a `sessions` other than `true` or `false` are refused with
`invalid_request`.

### Reading a chain of work

An epic's children are the work that was planned. Work found while doing them is
linked `discovered-from` the item it was found from, and often lands under
another epic or under none, so an epic can be closed with every child done while
the work it started is still growing. A chain follows that growth.

For a root item and a scope, the members are:

- `epic`: the items whose parent is the root.
- `chain`, the default: the root's children, then, repeated until nothing new is
  found, every item linked `discovered-from` the root or a member, and every
  child of a member.

The walk goes downward only. It never adds a member's parent and never follows
`discovered-from` from the item that was found to the item it was found from.
`relates-to`, `duplicates` and `blocks` never add a member. The root is never a
member, and members are always in the root's planning space.

`GET /api/planning/work-item/chain?id=<reference or work_item_id>&scope=chain|epic`
answers with `interface_version` and `chain`:

| Field | What it holds |
| --- | --- |
| `root` | `work_item_id`, `reference`, `title`, `kind` and `has_children`, true when any item names the root as its parent |
| `scope` | `chain` or `epic` |
| `total`, `closed`, `open`, `ready` | how many members there are, how many are in a terminal state, how many are not, and how many are ready |
| `by_category` | members per workflow category, for the categories that have any |
| `origins` | members grouped by their parent: `parent_reference` and `parent_title` (`null` for members without a parent), `count` and `open`. The root's own children come first, then the larger groups |
| `series` | one entry per UTC day on which a member was created or closed, oldest first: `day` (`YYYY-MM-DD`), `created`, `closed`, and the running totals `total` and `closed_total` |
| `recent` | the last 7 UTC days, today included: `days` (7), `created`, `closed`, and `trend`, which is `growing` when more were created than closed, `converging` when fewer, and `steady` otherwise |
| `members` | every member, by number: `work_item_id`, `reference`, `title`, `state` (`key`, `name`, `category`, `is_terminal`), `claim_ref`, `claim_state`, `parent_reference`, `created_at`, `closed_at`, `ready` and `rank` |
| `edges` | the `blocks` and `discovered-from` links whose two ends are the root or members: `from`, `to` (work item ids) and `kind` |

A member's `closed_at` is when it last changed state, if its state is terminal:
the time of its latest transition, or of its last update when it never had one.
It is `null` for an open member. `ready` is the rule every work item record
uses: unheld, not a parent, in a state work can start from, and not blocked by
anything unfinished.

A member's `rank` is its 1-based place in the order of work across its whole
planning space: the states by category (`active`, `review`, `queued`,
`backlog`, `blocked`, `completed`, `cancelled`), then the workflow's order of
states, then the place inside a state, as described in
[The order of work](#the-order-of-work). It is counted over the space, not over
the chain, so two members' ranks are compared and never counted between: a gap
means work outside the chain stands between them.

A `scope` other than `chain` or `epic` is refused with `invalid_request`, and so
is an unknown item, as on `GET /api/planning/work-item`.

The MCP tool `get_work_item_chain` takes `id`, `scope`, `offset` and `limit`, and
answers with the same fields except `members` and `edges`, with only the newest
30 entries of `series`. In their place it carries `open_members`, one compact
row per open member: `reference`, `title`, `state` (the key), `claim_ref`,
`ready`, `parent_reference` and `rank`. They come in the order a reader acts on
them: active members, then members in review, then ready ones, then the rest,
each group in the order of work. The rows are paged like a list: at most `limit` per answer, 50
by default and at most 200, with `truncated` and `next_offset`.

### Several changes in one call

`apply_work_item_changes` applies several writes to one item in one call, all or
nothing. It takes `id`, `author`, `expected_revision`, `verbose` and any of
these groups, and applies them in this order:

| Group | Shape | Works as |
| --- | --- | --- |
| `claim` | `true` | `claim_work_item`; `false` is no change |
| `checklist_ticks` | list of `{item_id, done?}`, `done` true by default | `tick_work_item_checklist_item` |
| `refs` | list of `{kind, value, label?}` | `attach_work_item_ref` |
| `links` | list of `{other, kind, remove?}`, linking from this item | `link_work_items` |
| `comment` | `{body, checklist_item_id?}` | `comment_work_item` |
| `summary` | `{done, next, why?}` | `set_work_item_summary` |
| `transition` | `{state, reason?, force?, rank?}` | `transition_work_item` |

Each step is the write its single tool makes, with the same guards, events,
revision bumps and refusals, so a closing transition is judged after the ticks
and the summary sent with it. A list holds at most 100 entries. At least one
group must name a change, and an entry with a field its group does not take is
refused; both are `invalid_request` before anything is written.
`expected_revision` is checked once, against the item as the call found it.

The steps run inside one transaction. When one is refused, none of them is
written, and the error body keeps the refusal's code, prefixes its message with
the step, and names the step:

```json
{"error": {"code": "workflow_guard",
 "message": "transition: [checklist] WIR-3 has 1 open checklist step(s); …",
 "step": {"group": "transition", "index": 0}}}
```

`index` is the entry's position in a list group and 0 for the others. A refused
stale revision keeps `expected` and `actual` beside it. The call is recorded as
one call with its identity, and every row its steps write points to that call.

### Creating an item with its claim and links

`create_work_item` (`POST /api/planning/work-items`) also takes two optional
arguments that act on the item it creates:

| Argument | Shape | Works as |
| --- | --- | --- |
| `claim` | `true` | `claim_work_item`; `false` is no change |
| `links` | list of `{other, kind}`, linking from the new item, at most 100 | `link_work_items` |

They apply in the same transaction as the creation: the item is created, then
claimed, then linked, each step being the write its single tool makes, with its
events. Work found en route is filed in one call this way, linked
`discovered-from` the item it was found from. A malformed `claim` or `links`,
or an entry with a field other than `other` and `kind`, is refused with
`invalid_request` before anything is written. When a step is refused — a link
to an unknown item, say — nothing is created, no number is spent, and the error
names the step the way a refused batch step does:

```json
{"error": {"code": "invalid_request",
 "message": "links[1]: no work item WIR-99",
 "step": {"group": "links", "index": 1}}}
```

The answer adds `applied`, in the batch's style: `{"claim": true, "links": 2}`.
The call is recorded once with its identity, and the creation's, the claim's and
both ends of each link's events point to it. Without `claim` or `links`, the
call and its answer are what they were before.

The acknowledgement's `applied` names only the groups that changed something:

```json
{"claim": true, "checklist_ticks": [{"item_id": "…", "done": true}], "refs": 1,
 "links": 1, "comment": {"comment_id": 41}, "summary": {"summary_comment_id": 42},
 "transition": {"state": "done"}}
```

The single tools stay as they are. The batch is also the HTTP write
`POST /api/planning/work-item/apply`, which takes the same body and answers with
the full item and `applied`.

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
tool takes, for example
`get_work_item: unknown argument 'item'; expected 'id' (required), 'full'`.

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

Every history event that `get_work_item` or a write with `verbose: true`
answers with carries its call's identity:

```json
{"action": "claimed", "detail": "", "author": "codex", "at": "2026-10-31T09:00:00Z",
 "identity": {"state": "confirmed", "source": "codex-meta", "session_id": "019a…", "agent_id": null}}
```

An event written before calls were recorded, or by the execution runner outside
any call, has
`{"state": "unconfirmed", "source": null, "session_id": null, "agent_id": null}`.
A write from the browser UI is `confirmed` with source `browser` and no session;
see [Local HTTP security](../README.md#local-http-security).

`browser` means this and no more: the request carried the fetch metadata a
browser sets on its own -- `Sec-Fetch-Site: same-origin` -- together with the
process's browser session token, and the token itself was handed out only to a
request that carried the same metadata. A browser sets that header on every
request to 127.0.0.1 and does not let a page change it; an HTTP client a local
process runs sends none unless it forges it on purpose, and both the token
bootstrap and every browser-credential write refuse a request without it, with
`403` and the code `fetch_metadata_refused`. A local process that deliberately
forges the header is outside this model: it runs as the owner and could edit
the store file directly. The adapter endpoint, `/api/ingest` with the
installation bearer and no `Origin`, is unchanged and needs no fetch metadata.

A write Valkama
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
truncation flag. A source that was not read says why in `reason`, as one stable
code: `store_not_attached` (the project's space lives in a store this server
neither owns nor has attached), `store_unreadable` (an attached store could not
be opened), `attached_list_unreadable` (the list of attached stores could not be
read), `space_missing` (the bound store holds no such space), `binding_conflict`
(the space is bound to another project), `search_failed` (the store opened but
the search failed there) or `requests_unavailable` (an attached store predates
human requests). The mapped search answers the item a reference query names
first, the primary store's ahead of an attached store's, before it cuts the
page. A request detail or mutation returns the confirmed request with
its target; attached stores remain read-only. Existing Planning searches and
the complete space read model keep their existing scope and limits.

### Server identity

The `serverInfo` in the discovery result reports version `1.0.0+<build>`, where
the build is the first twelve hex characters of a digest over the modules the
process started with.

The release number alone was a literal that had never moved, so two servers from
different checkouts introduced themselves identically.

## Running one version against another's data

A stdio MCP server is spawned by its client and lives as long as the session
does. The client owns that process, and a server that killed itself mid-call
would lose the call rather than repair anything. What can change is what runs
behind the pipe.

### A release switch under a running session

When the launcher's command starts `valkama.py mcp` and the launcher still
names that release, the process is a **front**, not the server. It holds the
client's stdin and stdout for the session and runs the server as a
**backend**: a child process, `<interpreter> <release>/valkama.py mcp`, of the
release the launcher names now. Any other start of `valkama.py mcp` serves
in-process. The design and the alternatives it was chosen over are in
[ADR 0011](decisions/0011-release-switch-through-a-stdio-front.md).

What the client sees:

- **Its requests arrive unchanged.** Each line reaches the backend as the bytes
  the client wrote, so `_meta`, `_identity` and request ids are untouched.
- **`tools.listChanged` is declared.** The front adds `"listChanged": true` to
  `capabilities.tools` in an `initialize` result and a `server/discover`
  result. Nothing else in an answer changes, except the warning below.
- **`subscriptions/listen` is answered by the front.** On a connection with no
  handshake, the front acknowledges a stream with
  `notifications/subscriptions/acknowledged` carrying the listen request's id in
  `_meta["io.modelcontextprotocol/subscriptionId"]`, and agrees to
  `toolsListChanged` only, the one notification it can send. The stream stays
  open until the client sends `notifications/cancelled` for that id; when the
  session ends, the front answers the listen request with
  `{"resultType": "complete"}` and the same `_meta`. A listen request naming a
  version the backend does not serve is refused with
  `UnsupportedProtocolVersionError` (`-32022`). After an `initialize` it is
  passed to the backend, which does not know the method: the handshake
  revisions have no streams.
- **stdout carries only protocol frames.** A backend line that is not a
  JSON-RPC message is dropped and reported on stderr. A backend's stderr is
  passed through to the front's.

How a switch goes:

1. The front reads the launcher manifest before every request it forwards, and
   every 2 seconds while the client is idle. A launcher that is not `installed`
   names no release, and the session keeps the one it has.
2. A switch waits for the request in flight to be answered: one lock covers a
   request's round trip and a switch, so a request finishes on the backend that
   received it and is never sent twice.
3. The new release is asked for `capabilities`, which reads no user data. If
   that fails, the old backend goes on serving.
4. The old backend is stopped: its stdin is closed, and its process tree is
   killed if it has not exited within 5 seconds. Only then does the new one
   start, so two backends of one session never run at once and an old release
   never writes a store the new one has migrated.
5. The new backend is asked `server/discover`, and must answer within 120
   seconds. A client that made a handshake has its `initialize`, and its
   `notifications/initialized`, replayed to it, so the backend knows the
   client's era and `clientInfo`.
6. The front asks the new backend for its tools and compares them with the last
   list the client received. When they differ, it sends
   `notifications/tools/list_changed`: bare to a client that made a handshake,
   and on every stream that agreed to `toolsListChanged`, with that stream's
   `subscriptionId`, to a client that did not. A client with neither hears
   nothing.

A release that fails after the old backend stopped — a store it refuses, an
exit before it answers — is stopped, and the previous release is started
again. Either way the next tool result carries one more content block, appended
after the payload, that names the release and why it failed, and that release
is tried again only once the launcher names another one. If the previous release
cannot start either, which is the case when the failed one migrated the store
first, the request is answered with a JSON-RPC error that carries the store's
refusal, and the front exits.

A backend that exits mid-session ends the session's server the same way: the
request it held is answered with an error, never resent, and the front exits
with status 1, which leaves restarting the server to the client.

Measured on Windows 11 with Python 3.15.2 and a throwaway store, switching a
running session between two releases of this repository:
`notifications/tools/list_changed` arrived 2.4 to 4.6 seconds after
`launcher install` returned, and the first `server/discover` through the
launcher took a median of 0.29 seconds with the front against 0.21 seconds for
a release without it, over 10 starts each.

What the clients do with the notification, as of 2026-10-31:

| Client | Revision it opens with | On `notifications/tools/list_changed` |
| --- | --- | --- |
| Claude Code 2.1.304, CLI | 2026-07-28 on stdio by default | Opens `subscriptions/listen` itself when the discovery result declares `listChanged`, and lists the tools again. A tool schema the model has already loaded can stay in its context. |
| Codex CLI 0.166.0 | the handshake revisions by default | Logs it. With the `mcp_tool_list_changed` feature, which is off by default, it lists the tools again at its next catalog read. |

So in Codex, by default, every call reaches the new release, but a tool the new
release added stays invisible until the session restarts.

The front itself is the one part a switch does not replace: a session keeps
the front it started with. A front that is killed from outside leaves its
backend to see stdin close and exit on its own.

### A process that went stale while it ran

`static_assets.SourceWatch` covers a process with no front: a checkout run
whose sources changed, a session opened with a release from before the front,
or a release the launcher started while its own files had drifted. The first
tool result after the drift carries an extra content block saying so and naming
the one fix: restart the client session. The agent keeps that block in its
context, so it is not repeated on every answer: a reminder follows only when at
least 30 minutes have passed since the last one, and a process sends three in
all.

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
`StoreTooNew` and is not touched. A front that switches to such a build gets
that refusal as the build's failure to start, and keeps the release it had.

Raise the number in the same commit that changes what an existing row *means*.
Migrations here are forward-only and idempotent, so it is the change of meaning,
not an added column, that this exists to stop.
