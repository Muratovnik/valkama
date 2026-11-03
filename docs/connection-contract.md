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
item: `reference`, `url`, `work_item_id`, `revision`, `state` (`key`, `name`,
`is_terminal`), `claim_ref` and `claim_state`, plus what that call changed. `url`
is described in [The address of a work item](#the-address-of-a-work-item).
`revision` is the value to pass as `expected_revision` on the next write.
`claim_state` is the holder's lease, described in
[Claims are leases](#claims-are-leases).

| Tool | Also carries |
| --- | --- |
| `create_work_item` | `title`, `kind`, `priority`; `applied` when it took `claim` or `links`; `started` and `warnings` from its claim when there are any |
| `update_work_item` | `updated`, the names of the fields it edited |
| `transition_work_item` | `released`, the holder a close released (see [A close ends the claims](#a-close-ends-the-claims)); `warnings` and `overridden`; each when there is one |
| `claim_work_item` | `claim_ref` is the holder and `claim_state` its lease; `started`, `requeued` and `warnings` when there are any (see [A claim starts the work](#a-claim-starts-the-work)) |
| `set_work_item_checklist` | `checklist`, the steps as `item_id`, `text` and `done` |
| `claim_work_item_checklist_item`, `tick_work_item_checklist_item` | `step`: `item_id`, `done`, `claimed_by`, `done_by` |
| `set_work_item_summary` | `summary_recorded: true` |
| `apply_work_item_changes` | `applied`, what each group changed, with `released` in `applied.transition` when a close released a claim; `started` from its claim, `overridden` from its transition, and the `warnings` of both, when there are any |
| `merge_work_items` | `merged`, what each item moved (see [Merging items that are one change](#merging-items-that-are-one-change)); `warnings` and `overridden` when there are any |

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
match keeps its order, most recently changed first. A query that is a number
alone -- `12` -- does the same for the item numbered 12: in a search scoped to
a space that is one item, and without a space it is each space's item 12.
`list_work_items` also takes `parent`, a work item by reference or id, and then
lists only that item's children; the HTTP read `GET /api/planning/work-items`
takes the same `parent` parameter. An unknown `parent` is refused with
`not_found`.

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

A work item named by reference or id that no item answers to is refused with
`not_found`, and over HTTP with status 404, wherever it is named: the item a
read or a write is about, a `parent`, the other end of a link, or a step of a
batch, which keeps its `step`. A reference that does not read as one -- not
`KEY-NUMBER` and no item's id -- is still `invalid_request`: the request is
malformed, not about an item that is missing, and a caller tells a person
something different about each.

With `verbose: true` they answer with the full items, at the limits they had
before (200 for a list, 50 for a search), and with the same `truncated` and
`next_offset`. The HTTP reads `GET /api/planning/work-items` and
`GET /api/planning/search` take the same `offset` parameter and carry the same
two fields.

### Naming a state

A workflow's states are rows, so their keys belong to the space: the default
workflow keys its active state `dev`, and another workflow may call it something
else. What every workflow shares is the category. Wherever a write names a
state -- the `state` of `transition_work_item`, of the `transition` group of
`apply_work_item_changes`, of `create_work_item`, and of their HTTP writes -- it
is read, in this order, as:

1. a `state_id` or a key of the item's workflow;
2. a category (`backlog`, `queued`, `active`, `review`, `blocked`, `completed`,
   `cancelled`) that exactly one state of the workflow has.

A key wins over a category, so `review` is the state keyed `review` even in a
workflow that gives the review category to two states. A category that two or
more states share is refused with `invalid_request`, naming their keys:
`category active names 2 states in this workflow: dev, pairing; name one by its
key`. A name that is neither is refused with `invalid_request` listing every
state as `key (category)` and the categories that name a state alone:

```text
this workflow has no state named in_progress; its states are backlog (backlog),
todo (queued), dev (active), review (review), done (completed), blocked (blocked),
cancelled (cancelled); a category names a state when exactly one state has it:
backlog, queued, active, review, completed, blocked, cancelled
```

Both refusals come before any guard and write nothing. Reads keep their two
filters apart: `list_work_items` takes `state` as a key and `category` as a
category.

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

A placement writes no history event on purpose. Every build that opens the
store reads the same history, and a build that predates placements checks each
event's action against the closed list it knows: its card would refuse an item
whose history held a placement. The call's row in the execution tree (see
[Call identity](#call-identity)) and the revision record a placement instead. A
transition that carries `rank` writes its `transitioned` event as before; the
placement adds none.

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

With the optional integer `comments_after` it answers with every comment whose
id is greater than that one, oldest first, however many there are, and the
events and the three counting fields as usual; `history_truncated` stays true
when older comments were left out. This is how a reader that keeps the id of the
last comment it read takes only what came since. Comment ids run across items,
so the id need not belong to this item. With `full: true` it is refused.

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
newest entries), `comments_after` and `sessions=true`. With both `comments` and
`comments_after` it keeps that many of the newest comments after the id. A count
that is not a non-negative integer
and a `sessions` other than `true` or `false` are refused with
`invalid_request`; an unknown item is `not_found` (404).

### The address of a work item

`GET /open/<reference>` opens one work item in the web UI, so that an agent can
hand a person a link built from nothing but a number. A client does not turn a
bare number into a link, and the address of a card itself cannot be written from a
number: it names the project and the store.

The reference is read as a search reads one, so `main-12` is `MAIN-12`, and its
prefix names the space. The route is a loopback address under the same `Host` rule
as every other, and it answers:

| The address | Answer |
| --- | --- |
| names an item in a space a project binds, followed by a person, with the desktop app installed | `200` and a small page, after starting the app on the card; see below |
| names an item in a space a project binds, in any other case | `302` to `/modules/planning/project/<project>?entity=<entity>`, the route the card has when it is opened any other way, with `Cache-Control: no-store` |
| names anything else | the app page with `404`, which says what is wrong and offers the next step |
| reaches a store or a project registry that cannot be read | the app page with `503`, which offers another try |

The redirect is the card's own route, so the address bar, Reload and Back behave
as they do after any other navigation. Nothing the address says reaches the
redirect but a reference the grammar accepted and a store confirmed, and the
surface checks the result against the one shape a card route has: `/open//evil`,
`/open/https:%2F%2Fevil` and the like get the app page, never a `Location`. Primary
and attached stores can each keep a space with one key; the primary answers first.
A space no project binds has no card route, so the page says there is no such space.

The page reads why from `GET /api/modules/planning/search`, whose coverage names
each source it read and each it could not: a number nobody filed, a key no project
binds, and a store that did not answer read differently, and an item is never
called missing while a store that may hold it stayed silent.

An agent client's chat keeps a link only for ordinary schemes and opens it in the
default browser, so a link always arrives through a browser tab, and a scheme of the
product's own would not survive the chat. On Windows the listener therefore hands the
card to the desktop app itself when all of these hold:

- the request is a navigation started outside any page: exactly one each of
  `Sec-Fetch-Site: none`, `Sec-Fetch-Dest: document` and `Sec-Fetch-Mode: navigate`,
  and neither `Sec-Purpose` nor `Purpose`, which mark a prerender of an address still
  being typed. An address opened from another application, typed or bookmarked is
  such a navigation. Nothing a page does is. A redirect keeps those values, so a
  foreign address opened from outside the browser and sent on here does start the app:
  on the card it names, with nothing written and any draft asked about first;
- the query does not say `in=browser`;
- `%LOCALAPPDATA%\Programs\valkama-desktop\Valkama.exe` exists;
- the listener is on the port `VALKAMA_PORT` names, or the default. A second
  `serve --port` keeps its links to itself, because an open window belongs to the
  expected listener and would look the card up in the wrong store.

The app starts detached, with `--open-path=<card route>`, its own directory as working
directory, `VALKAMA_PORT` set to this listener's port and no `ELECTRON_RUN_AS_NODE`. It
takes the argument at first start and on a second launch, ignores any other shape, and
raises its window. A window already showing a current page hands the route to it over
the preload bridge and its router moves, so nothing reloads and a draft is asked about
as on any other departure; a page older than the app gets a load, which its own
`beforeunload` refuses while it holds a draft. The page the listener answers is `no-store`, says the item opened in the app,
links to `/open/<reference>?in=browser` and closes its own tab. A browser lets a script
close only a tab with a single history entry, and some let it close none; such a tab
stays open on that page. Its address has already been replaced by the link, so a
reload or a restored session shows the card instead of starting the app again.

If the app cannot be started the answer is the `302`. A child that starts and then
fails is not seen, and a Desktop build older than the listener opens without moving to
the card.

A work item's full record in an MCP answer (`get_work_item`, a `verbose` write,
`claim_ready_work_item`) and every write acknowledgement carry the address as
`url`:

```json
{"reference": "MAIN-12", "url": "http://127.0.0.1:8642/open/MAIN-12", "revision": 3}
```

It is an addition: the rows of `list_work_items` and `search_work_items`, the tool
schemas and the HTTP records have no `url`. The port is `VALKAMA_PORT`, the variable
the desktop app already reads, and otherwise the default `serve` listens on, and it
is built in one place. An MCP process cannot ask a listener, so a `serve --port`
started by hand on another port is not seen unless `VALKAMA_PORT` says so too.

The server's instructions tell an agent to write a number as a markdown link to
this address in a message to the owner, and not in a Valkama comment or
description, where the UI links numbers by itself. Those instructions stay under
4096 characters, the point where Claude Code 2.1.314 cuts them.

The address needs a listener. While nothing listens on the port, following it ends
in the browser's own connection error. On Windows `launcher autostart enable` keeps
a listener on the port from login, which loads the server when the first address is
followed ([`SERVICE.md`](../SERVICE.md#holding-the-port-from-login)).

### What a link says about its other end

A reader judges a link by the item at its far end: a `blocks` link holds only
while its blocker is unfinished, and that blocker may live in another space,
under another workflow. So a link names that end's state itself, and nobody has
to read the other item to know.

- In a work item's full record (`get_work_item`, `GET /api/planning/work-item`),
  each link, in either direction, names its other end: `state_name`,
  `state_category`, `is_terminal` and `state_unavailable`.
- In a space's view (`links` in `GET /api/planning` and
  `/api/events?view=planning`, `edges` in `GET /api/planning/graph`), the links
  leaving the space come with every `blocks` link into it from another space,
  so `from` can name an item the view does not hold. Each link names its source
  end, `from`: its `reference` and the same four state fields. A graph's
  `parent` edges carry none of them.
- A chain's `edges` name their source the same way; see
  [Reading a chain of work](#reading-a-chain-of-work).

When the store cannot resolve that end's state, `state_name`, `state_category`
and `is_terminal` are `null` and `state_unavailable` is `state_missing`;
otherwise `state_unavailable` is `null`. An end whose state is unknown is not
open, and as a blocker it blocks nothing. A reader of an older server finds no
such fields and looks the end up among the items it holds.

The cross-project search, `GET /api/modules/planning/search`, marks each result
the same way: `item` carries `kind` and `priority`, and `item.state` carries
`category` and `is_terminal` beside its name.

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
| `edges` | the `discovered-from` links whose two ends are the root or members, and every `blocks` link into the root or a member, wherever its source lives: `from`, `to` (work item ids), `kind`, and the source's `reference`, `state_name`, `state_category`, `is_terminal` and `state_unavailable` |

A member's `closed_at` is when it last changed state, if its state is terminal:
the time of its latest transition, or of its last update when it never had one.
It is `null` for an open member. `ready` is the rule every work item record
uses: unheld, not a parent, in a state work can start from, and not blocked by
anything unfinished.

An edge names its source because a member waits on its blocker whether or not
that blocker belongs to the chain, or to the space, so `from` need not be a
member. When the store cannot resolve the source's state, `state_name`,
`state_category` and `is_terminal` are `null` and `state_unavailable` is
`state_missing`; such a source is unknown, not open, and blocks nothing.

A member's `rank` is its 1-based place in the order of work across its whole
planning space: the states by category (`active`, `review`, `queued`,
`backlog`, `blocked`, `completed`, `cancelled`), then the workflow's order of
states, then the place inside a state, as described in
[The order of work](#the-order-of-work). It is counted over the space, not over
the chain, so two members' ranks are compared and never counted between: a gap
means work outside the chain stands between them.

A `scope` other than `chain` or `epic` is refused with `invalid_request`; an
unknown item is `not_found` (404), as on `GET /api/planning/work-item`.

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
| `checklist` | `{items, force?}`, each step text or `{text, done?}` | `set_work_item_checklist` |
| `checklist_ticks` | list of `{item_id, done?}`, `done` true by default | `tick_work_item_checklist_item` |
| `refs` | list of `{kind, value, label?}` | `attach_work_item_ref` |
| `links` | list of `{other, kind, remove?}`, linking from this item | `link_work_items` |
| `comment` | `{body, checklist_item_id?}` | `comment_work_item` |
| `summary` | `{done, next, why?}` | `set_work_item_summary` |
| `transition` | `{state, reason?, force?, rank?}` | `transition_work_item` |

Each step is the write its single tool makes, with the same guards, events,
revision bumps and refusals, so a closing transition is judged after the ticks
and the summary sent with it.

`checklist` sets the steps, as `set_work_item_checklist` does. A step sent
with the text of a step the item has is that step: it keeps its `item_id`, its
claim, its tick and who made them, and duplicate texts match in order. So steps
are appended by sending the item's steps and then the new ones, and a step is
renamed by sending `{"id": "…", "text": "…"}`, a shape the published schema
does not advertise but every write takes. Leaving out a claimed or completed step is refused, naming it, and
`force` discards it explicitly; a step with neither may be left out freely.
A new step gets a new `item_id`, and `applied.checklist` lists every step as
`{item_id, text, done}`, so `checklist_ticks` in the same call can name only
steps the item already had. A step that is done when it is set is sent as
`{"text": "…", "done": true}` instead: it is recorded done by the caller, with
the `checklist_completed` event a tick writes, so a call that sets done steps,
a summary and a closing transition closes the item. A repeated step sent done
is ticked the same way, and refused as a tick is when someone else holds it,
unless `force`; one sent without `done` keeps its tick, and a step is reopened
only by a tick with `done: false`. A step that names an `id` the item
does not have is one carried over and keeps the state it carries. A list holds
at most 100 entries. At least one
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

The acknowledgement's `applied` names only the groups that changed something:

```json
{"claim": true, "checklist": [{"item_id": "…", "text": "write it", "done": false}],
 "checklist_ticks": [{"item_id": "…", "done": true}], "refs": 1,
 "links": 1, "comment": {"comment_id": 41}, "summary": {"summary_comment_id": 42},
 "transition": {"state": "done"}}
```

The single tools stay as they are. The batch is also the HTTP write
`POST /api/planning/work-item/apply`, which takes the same body and answers with
the full item and `applied`.

### Creating an item with its claim, steps and links

`create_work_item` (`POST /api/planning/work-items`) also takes three optional
arguments that act on the item it creates:

| Argument | Shape | Works as |
| --- | --- | --- |
| `claim` | `true` | `claim_work_item`; `false` is no change |
| `checklist` | `{items}`, as the batch's group takes it, without `force` | `set_work_item_checklist` |
| `links` | list of `{other, kind}`, linking from the new item, at most 100 | `link_work_items` |

They apply in the same transaction as the creation: the item is created, then
claimed, then given its steps, then linked, each step being the write its
single tool makes, with its events. The claim starts the new item, so an item
created with `claim: true` answers in its active state with `started`. Work
found en route is filed in one call this way, linked `discovered-from` the item
it was found from. A malformed `claim`, `checklist` or `links`, or an entry
with a field its argument does not take, is refused with `invalid_request`
before anything is written. When a step is refused — a link
to an unknown item, say — nothing is created, no number is spent, and the error
names the step the way a refused batch step does:

```json
{"error": {"code": "not_found",
 "message": "links[1]: no work item WIR-99",
 "step": {"group": "links", "index": 1}}}
```

The answer adds `applied`, in the batch's style: `{"claim": true, "links": 2}`.
The call is recorded once with its identity, and the creation's, the claim's and
both ends of each link's events point to it. Without `claim`, `checklist` or
`links`, the call and its answer are what they were before.

### Merging items that are one change

`merge_work_items` (`POST /api/planning/work-item/merge`) folds items that turned
out to be one change into the item that survives. It takes `id`, the survivor;
`items`, 1 to 20 items that merge into it; and optional `reason`, `force`,
`expected_revision` (the survivor's), `author` and `verbose`. It is all or
nothing, in one transaction.

What moves to the survivor:

- the checklist steps, after its own, with their `item_id`s, ticks and step
  claims, so a step's holder finds it by the same id;
- the discussion comments, including those bound to a step;
- the requests, so a pending one goes on standing on the survivor and can be
  answered there;
- the refs, except one the survivor already has, which stays where it was;
- the links, each in its own direction: `MAIN-13 blocks MAIN-20` becomes
  `MAIN-12 blocks MAIN-20`. A link to the survivor or to another item of the
  same merge stays on the merged item, because moved it would tie the survivor
  to itself. A `blocks` link that arrives can make the survivor block work it
  did not block before, and one into it can make it wait.

Each merged item is then linked `duplicates` to the survivor, gets a summary
naming it ("Merged into MAIN-12, which now holds its 2 steps, 1 comment, 0 refs
and 1 link.", `next` "Continue in MAIN-12.", `why` the reason), loses its claim
and closes in the first `cancelled` state its workflow reaches from where it
stands, with the reason `duplicate of MAIN-12`. The survivor gets a comment
saying what came in. What describes the merged item itself stays with it: its
history, its reports, its description, labels and parent. The
survivor keeps its own state, holder, fields and parent; nothing is reopened or
claimed.

Refused with `invalid_request` before anything is written, naming the item:
the survivor in `items`, an item named twice, an item in another planning space,
a closed survivor or merged item, a merged item with children, more than 100
steps in all, a workflow with no reachable cancelled state, and an item another
session holds. A stale lease does not count, and a claim held by the caller is
its own. `force` carries another session's claim through and is recorded as an
`overridden` event with the detail `claim` on that item, and it carries a guard
that refuses the close the way `transition_work_item` does.

Every write is one a single tool makes, with that tool's event: `linked` and
`unlinked` on both ends of each link, `checklist_replaced`, `released`,
`summarized`, `transitioned` and `overridden`. No event action, field or table is
new, so a build from before merging reads a merge as those ordinary changes. The
call is recorded once, against the survivor.

The answer is the survivor with `merged`, one entry per item in the order given,
and `warnings` and `overridden` when there are any:

```json
{"reference": "MAIN-12", "revision": 9, "merged": [
  {"reference": "MAIN-13", "work_item_id": "…", "state": "cancelled",
   "moved": {"steps": 2, "comments": 1, "refs": 0, "links": 1}}],
 "warnings": ["MAIN-13 stays under MAIN-4; MAIN-12 keeps its own parent"]}
```

A warning names a merged item that had another parent than the survivor, and one
whose pending requests now wait on the survivor. The HTTP write answers with the full survivor and the same
`merged`, `warnings` and `overridden`; the tool answers with the acknowledgement
unless `verbose` is true. Why it moves what it moves is
[ADR 0013](decisions/0013-merging-work-items.md).

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

`stale` says nobody is working the item now, not that the claim is gone. A
session that ended may come back: a client restart ends the session and resumes
it under the same id seconds later, so a lease whose session is `ended` keeps its
claim for 12 hours after `ended_at`, its grace. A `session_start` hook event or a
confirmed call from that session within the grace makes the lease `live` again,
with no write to the item. A session with no `ended_at` has no grace, and neither
has a `failed` one, which only a session start reopens.

`get_work_item`, a `verbose` write and the HTTP item read carry the lease as
`claim`:

```json
{"holder": "codex (session 019a…)", "state": "live", "session_id": "019a…", "agent_id": null,
 "source": "codex-meta", "acquired_at": "2026-10-31T09:00:00.120Z",
 "last_seen": "2026-10-31T09:40:12Z", "expires_at": "2026-11-14T09:40:12Z"}
```

`holder` is `claim_ref`. `acquired_at` is when the claiming call arrived and is
`null` for a claim that names no call; `last_seen` is the session's, and
`expires_at` is `last_seen` plus 14 days while the lease is `live`, `null`
otherwise. It answers how long a session that shows no sign of life keeps a live
lease, and promises nothing about a session that ends: from that moment the lease
is `stale`, `expires_at` is `null`, and the grace above applies. `claim` is
`null` when nobody holds the item. Every item record, full
or listed, carries `claim_state`; `claim_ref` and `ready` mean what they meant.

### Who holds a claim or a step

A claim and a checklist step record their holder as text: `claim_ref`, and a
step's `claimed_by` and `done_by`. When the write call is `confirmed` with a
session -- source `codex-meta` or `claude-hook` -- the holder is that session,
whatever `author` the call signs with:

| The call comes from | The holder reads |
| --- | --- |
| a Codex session | `codex (session <sessionId>)` |
| a Codex subagent (`threadId` differs) | `codex agent <threadId> (session <sessionId>)` |
| a Claude Code session, through the hook | `claude (session <session_id>)` |
| a Claude Code subagent | `claude agent <agent_id> (session <session_id>)` |

The name is the identity channel's, not the handshake's `clientInfo`, so one
client reads the same either way it opens. An id is carried as it is when it is
at most 40 letters, digits, `.`, `_`, `:` or `-`, which both clients' ids are;
any other id is carried as the first 16 hex digits of its SHA-256, which keeps
the holder within the 128 characters a holder may have.

Every other call holds by its `author`, as every claim did before: an
`unconfirmed` call, a call with no identity, the browser (`user` unless the
payload names someone), a launch (`<client>:<role>`). `author` itself is what
the history records about the call: each event, comment and ref keeps the
author the call signed, beside the identity its call row proved.

Holding by session changes three comparisons:

- Two sessions that sign with the same author hold two different claims and
  two different steps, so one cannot tick or release the other's step without
  `force`, and one subagent's step is not another's.
- A step held under a signature -- by an unconfirmed call, or before this
  change -- is still its signer's: a call whose `author` is that signature may
  tick or release it, whether or not its own session is confirmed.
- `list_work_items` with `owner` matches `claim_ref` exactly, so a session finds
  its own items by the holder its claim acknowledgement returned.

The text is the `name (session id)` spelling the web already reads as a name
and a session; MCP and HTTP answers carry the full label, and every web surface
prints a holder the same way: the name, then
the first two groups of the session id (`codex · 019a3c2e-5b7d`), because
UUIDv7 ids share their first group for sessions started within about a minute
of each other. A store keeps one
format: an earlier build reads the label as the name it always held, and no
row changes meaning, so the store schema stays where it is. Claims taken before
this change keep the text they were taken with until they are claimed again.

Who may release or take over a claim follows the lease:

- A call from the session that holds a `live` or `stale` lease is the holder,
  whatever `author` it signs with and whichever of its subagents makes it.
- Any other call needs `force` against a `live` lease, including a call from
  another session that signs with the same `author`, and a call with no
  confirmed session at all.
- `claim_work_item` on an item under a `stale` lease releases it before it does
  anything else, in the grace or not: whoever asks for that item takes it now,
  without `force`, and the session that comes back later finds it taken. Its
  history reads `released` and then `claimed`.
  `claim_work_item` with `release` on a stale lease stops after that release.
- `claim_ready_work_item` first releases every stale lease in its space that is
  past its grace. It neither gives nor releases an item whose lease is in the
  grace, because nobody asked for that item in particular.
- The release is a `released` event with the detail `<reason>: <holder>`, written
  by Valkama under its own call; an item it leaves unheld in an active state is
  put back in the queue under the same call, as any release does (see
  [A claim starts the work](#a-claim-starts-the-work)). The reason names what
  happened to the session:

  | Reason | The session |
  | --- | --- |
  | `session-ended` | ended or failed |
  | `session-missing` | has no row |
  | `lease-expired` | was last seen more than 14 days ago |

  Releases written before the reasons were told apart say `lease-expired`,
  whatever the cause, and stay as they were written.
- An `unconfirmed` claim is compared by `author`, as every claim was before
  leases, and never expires by itself.

An MCP server and `serve` also release every stale lease past its grace once
when they start. A grace is over at exactly 12 hours after `ended_at`, so a start
at that second releases the lease.

The space's list of abandoned claims (`stale_claims` in the read model) holds
every `stale` lease, in its grace or not, and every `unconfirmed` claim with no
event for three days, except the owner's own claim made in the browser. A claim a
launch took for its runner is listed like any other.

A claim still counts as the executor that starting an item requires. Starting
an item under an `unconfirmed` or a `stale` claim answers with a warning, not a
refusal, unless the claim was taken in the browser.

### A claim starts the work

The decision and the alternatives it was chosen over are in
[ADR 0012](decisions/0012-claims-start-work.md).

Taking an item is the moment its work starts, so a claim moves an item that has
not started into the workflow's active state, and a release moves work under way
back to where the take-next queue finds it. Both follow the state's category,
never its name. The rule holds for every write that claims: `claim_work_item`,
`claim_ready_work_item`, the `claim` of `create_work_item` and of
`apply_work_item_changes`, their HTTP writes, the browser, and a launch.

| The item is in | A claim (a take or a takeover) | A release (by its holder, `force`, or lease expiry) |
| --- | --- | --- |
| a `backlog` or `queued` state | moves it to the first `active` state, in workflow order, that a transition of the workflow reaches from where it stands | moves nothing |
| an `active` state | moves nothing | moves it to the first reachable `queued` state, or failing that the first reachable `backlog` state |
| a `review`, `blocked`, `completed` or `cancelled` state | moves nothing | moves nothing |

A move is the transition its single tool makes: the workflow's guards judge it,
it writes a `transitioned` event whose detail is the new key and the reason
(`dev: claimed`, `todo: released`, `todo: session-ended`, `dev: launched` for a
launch), it bumps the revision once more, and the item goes last in its new
state. A claim's move needs no further executor, because the claim is it. Its
answer, full or acknowledged, adds `started: {"from": "backlog", "to": "dev"}`;
a release's adds `requeued: {"from": "dev", "to": "todo"}`; and the move's
warnings, such as a claim no session confirmed, arrive in `warnings`.

Three cases keep the state where it is:

- A startable item whose workflow lets it reach no active state is claimed and
  stays put, with a warning: `MAIN-12 stays in Backlog: its workflow has no
  active state it can move to`.
- An active item whose checklist still has a claimed step is released and stays
  active, because that step's holder is still its executor.
- An active item with no reachable queued or backlog state is released and
  stays.

A review or blocked item says something a claim does not undo, and finished
work is reopened by a transition of its own, so a claim takes those over
without moving them. Release requeues because a claim starts its item: without
it, a released or expired claim would leave work in an active state that is not
`ready`, so `claim_ready_work_item` never offers it again, and not held, so
`stale_claims` does not list it either. A requeued item keeps its checklist,
comments and history, and goes to the queued state rather than the backlog it
may have come from, so the queue offers it before new backlog work.

`transition` sent beside `claim` in one `apply_work_item_changes` call applies
after the claim's move: `{"claim": true, "transition": {"state": "review"}}`
moves a backlog item to `dev` and then to `review`.

### A close ends the claims

A claim says somebody is working the item, and nobody works a closed one. So a
transition into a terminal state -- `completed` or `cancelled`, by
`is_terminal` -- releases the item's claim in the same write, whoever holds it.
The rule is in the one transition every surface makes: `transition_work_item`,
the `transition` group of `apply_work_item_changes`, the HTTP transition, a
drop on the board's Done column and the card's state menu. Closing therefore
takes one write, and the item stops reading as held at once instead of when its
lease runs out. `merge_work_items` already released each merged item before
closing it, and still does.

The history records the release beside the transition, with the same author
and call: `transitioned` (`done`), then `released` with the holder's
`claim_ref` as its detail. The answer names that holder as `released`, in the
acknowledgement, the `verbose` record and the HTTP answer, and in
`applied.transition` of a batch: `{"state": "done", "released": "codex (session 019a…)"}`.
A close of an item nobody holds releases nothing and carries no `released`. A
move between open states keeps the claim.

A checklist step's claim ends too, recorded as `checklist_released` with the
step's text. A completed close never has one: the guard requires every step
ticked, and a tick clears the step's claim. A cancelled close leaves its undone
steps open, and so can a close `force` carried past the checklist guard; those
steps stay open and become unheld, so a reopened item does not read as being
worked by their former holders.

Reopening a closed item -- a transition back to an open state -- restores no
claim. Whoever takes the work again claims it.

Who held the item is still on the record. The full record (`get_work_item`, a
`verbose` answer, `GET /api/planning/work-item`) and the briefs of the HTTP
reads (`GET /api/planning`, `GET /api/planning/work-items`) and the nodes of
`GET /api/planning/graph` carry two fields
that are `null` for open work; the compact rows of `list_work_items` and
`search_work_items` do not:

| Field | For a closed item |
| --- | --- |
| `closed_at` | when its latest transition happened, the rule a chain member's `closed_at` follows; when it was last written if it never moved |
| `last_claim_ref` | who held it when it closed, as `claim_ref` names a holder; `null` when it closed unheld |

`last_claim_ref` is the claim still on the item, for one a build before this
rule closed with its claim left live; otherwise the holder named by the newest
`released` event since the item's latest transition -- the release the close
wrote, or a separate release sent after an older close, including a lease that
expired then. A release before the close is not the holder at the close, and
the field is `null`.

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

An option is `{id, label, description?, recommended?}` and takes no other key.
`description` is markdown of 1 to 8000 characters and `recommended` a boolean, true
on at most one option of a `choice` and on any number of a `multi_choice`. What an
option was not given it does not say on the way back. The fields of one question
fit in 64 KiB as stored, and a refusal names the limit.

`answer_work_item_request` and `POST /api/modules/planning/request/answer` take
`answers` and an optional `note` of at most 8000 characters. A non-empty note stands
in for required fields, so `answers` may be `{}` and a person can answer in their
own words; an answer that is given is still checked against its field. A read gives
`answers` and `note` apart: `{}` and the note for such an answer, and `note: null`
when there is none. An answer is final, a second one is refused, and a comment over
an open question is not an answer.

A question stays a request. It writes no comment and the store's schema does not
change: a note is kept in `answers_json` under the key `_note`, which no field id
can take. A reader that opens `answers_json` itself, or a build from before notes,
sees that key among the answers.

An agent reads a question three ways:

- `get_work_item`, the tool, answers with `questions`:
  `{"total": 6, "open": 2, "items": […], "truncated": true}`. At most 5 items, the
  open ones first and then the newest closed. The HTTP read of a card has no such
  key.
- `list_work_item_requests` takes `space`, `id` (one item), `status`,
  `answered_after`, `limit` and `offset`, and answers in the compact form below, or
  whole with `full: true`. Its page says `truncated` and `next_offset` as every list
  does. `answered_after` keeps only answers given after that timestamp, oldest first
  by `answered_at` and then by id, so a reader takes what came since by passing the
  last `answered_at` it read and asking again while `truncated` is true. A page never
  ends between two answers of one time: it runs past `limit` by the tie, because the
  next page starts after that time. Without `answered_after` the newest question
  comes first.
- `get_work_item_request` answers with one question whole.

The compact form carries no options and no descriptions:

```json
{"id": "…", "status": "answered", "question": "Which way?",
 "answer": [{"field": "path", "value": "keep", "label": "Keep it"},
            {"field": "areas", "value": ["api", "web"], "label": "The API, The web"},
            {"field": "sure", "value": false, "label": null}],
 "note": "And the docs.", "answered_by": "user", "by_person": true,
 "answered_at": "2026-11-02T09:00:00.000000Z"}
```

`question` is the first 160 characters of the prompt, with `…` when it was cut.
`status` is the effective one. `field` is the field's id and `value` the answer as
stored; `label` is what was chosen in a `choice` or `multi_choice` and null for a
`boolean` or `text`. A field left out or empty has no row. `answered_by`, `by_person`
and `answered_at` are null with no answer; `by_person` keeps its meaning below on a
declined or withdrawn question, and the other two stay null there.

The compact form stays cheap to pull. A note, a written answer and a label are cut at
500 characters with `…`, and one question is at most 2000 characters of JSON: past
that it keeps its first fields and leaves out the rest. An item that lost anything
this way carries `clipped: true`, and one that lost nothing has no such key. The
whole text is in `get_work_item_request` and in the list with `full: true`.

`by_person` says whether the call that closed the question was a browser write, as
[above](#call-identity) defines it: true for one, false for any other call that
answered, declined or withdrew it, and null while no call has, which covers a question
still open and one that ran out by itself. Every read of a question has the key: the
HTTP reads a screen draws from, the answer of a write, the tools and an export. It is
read from that call's row, so no argument sets it, and `author` has no part in it: an
agent that signs as the owner reads `false`. It means "through the interface" and no
more. `GET /api/security/bootstrap` gives its token to any request with the fetch
metadata a browser sends, so a local process that sends them counts as the interface.
That is the boundary of local credentials, not a proof of who was at the keyboard.

`search_work_items` also reads a question's prompt, the labels and descriptions of
its fields and options, its answers and its note, and a row found that way carries
`question_hit`, the prompt. An option that was offered and not chosen is found too.
An export carries every question in `planning.requests`, whole.

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
page; a query that is a number alone answers each source's item of that number
first the same way. A request detail or mutation returns the confirmed request with
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
   start, so two backends of one session never run at once, and an old release
   of that session never writes a store its new one has migrated. A backend
   that still has not exited is never joined by another: the next request is
   answered with an error and the front exits. Each session switches on its
   own, so until another session has switched, its old release can still
   finish the one request it has in flight.
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
is tried again only once the launcher names another one. Pinning the same
commit again names the same release; restarting the session starts it afresh,
which is the way to retry a failure that has passed. If the previous release
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

The Valkama skill does not travel through the front. Its copies change only
when `launcher install` refreshes them or `skill install` writes them (see
[Install the skill](../SERVICE.md#install-the-skill)), and each client rereads
them on its own: a session can run the new release's tools with the skill text
it loaded before the switch until its client picks up the changed copy.

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
