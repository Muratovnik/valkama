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

**Since 2.5.** `comment_work_item` answers with `work_item`, `comment_count`,
`comment_id`, and the `reply_to` and `reply_to_request` of the root a reply
landed under; `resolve_work_item_comment` answers with `work_item`,
`comment_id` and `resolution`. Both are described in
[Threads and the resolved mark](#threads-and-the-resolved-mark).

`comment_work_item`, `report_work_item` and `set_work_item_summary` also answer
with `list_request_id` when the call wrote a [list](#a-list-on-a-comment), and
`comment_work_item` and `report_work_item` with `mentions` when the call named
other items (see [Mentions](#mentions)).

Every tool that writes to a work item and leaves it standing -- all of the above,
`claim_ready_work_item`, `link_work_items`, `attach_work_item_ref`,
`comment_work_item`, `report_work_item`, `select_work_item_summary` and the
question tools -- also carries `from_person` when a person acted on that item
through the interface since an agent last wrote to it, and only then; see
[What a person did reaches the agent](#what-a-person-did-reaches-the-agent).
A `verbose` answer carries it too. `delete_work_item` and `create_planning_space`
never do.

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

**Since 2.5.** Comments form threads (see
[Threads and the resolved mark](#threads-and-the-resolved-mark)), and the read
takes one of five modes:

| Mode | `comments` holds |
| --- | --- |
| default | the 5 threads with the latest activity -- a thread's activity is the greatest id in it -- oldest first; each root carries `replies` and `last_reply` |
| `thread: <id>` | that thread: its root and every reply, oldest first. The id of a reply reads the thread of its root. The replies under a question are read with `get_work_item_request` |
| `unresolved: true` | the unresolved roots, oldest first, at most 20, each with `replies` and `last_reply`; `truncated` says more remain, and the next page is read with `comments_after` set to the id of the last root read |
| `comments_after: <id>` | every row with a greater id, roots and replies alike, including replies under questions, flat and oldest first |
| `full: true` | every row, flat and oldest first |

`full`, `comments_after` and `thread` exclude one another, and `unresolved`
combines only with `comments_after`; any other pair is refused with
`invalid_request`. A reply to an old thread moves that thread up in the default
read, so news is not lost behind five newer roots.

`replies` counts the thread's replies. `last_reply` is the newest of them, or
`null` with none:

```json
{"id": 57, "author": "user", "by_person": true, "at": "2026-11-03T10:12:00.000000Z",
 "body": "Agreed, take the second option."}
```

Its `body` is cut at 500 characters, and a cut one carries `clipped: true`.

Every mode carries `comments_total` (every row, as before), `threads_total`
(the roots), `unresolved_total` (the roots without the resolved mark) and
`events_total`, except `full: true`, which carries none of them.
`history_truncated` is true when fewer threads, rows or events are shown than
exist.

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

The read also carries `mentions`, the comments on other items that named this
one; see [Mentions](#mentions).

The HTTP read `GET /api/planning/work-item` answers with the complete record and
no `sessions`, as before. It takes the same cut as opt-in parameters:
`comments` and `events` (non-negative integers, each keeping that many of the
newest entries), `comments_after` and `sessions=true`. With both `comments` and
`comments_after` it keeps that many of the newest comments after the id. A count
that is not a non-negative integer
and a `sessions` other than `true` or `false` are refused with
`invalid_request`; an unknown item is `not_found` (404).

**Since 2.5.** The HTTP read stays flat: comments are rows in id order, each
with its `reply_to` and `reply_to_request`, and a reader groups them into
threads itself. Neither it nor the card's read through the exact project scope
(`GET /api/modules/planning/work-item`) caps how many comments or events it
returns: a card is drawn from the whole record, however long its discussion and
history are, and a client must not refuse a record for its length. The same read
takes the agent's reads as opt-in parameters: `unresolved=true` with
`comments_after`, `thread=<id>`, and `threads=<count>` for that many threads with
the latest activity. `unresolved` other than `true` or `false` is `invalid_request`.

**Since 2.5.** The card's read through the exact project scope also takes
`brief=true`, which answers in the same envelope with the brief record a space's
list carries instead of the full one: state, title, holder, steps and dates,
with `comment_count` in place of the comments and no history, links, refs or
agents. Its size does not grow with the item's history, and it is what a
preview of a reference such as `MAIN-12` reads. Any other value of `brief` is
refused with 400; an unknown item is 404 and a binding that no longer resolves
is 409, as for the full read.

### Threads and the resolved mark

**Since 2.5.** A comment is either a root or a reply. A root has no parent; a
reply has exactly one, the comment or the question it answers. Comments,
reports and questions can be roots. A thread is one level deep: a reply to a
reply is not refused, it is placed under the root of the reply it named, and the
answer says which root that was. A reply lives on the same item as its root,
carries no `checklist_item_id` (the root carries the step), and a report is
never a reply. The store enforces the same shape, so no writer can break it.

Every comment, in every read, carries four keys beside the ones it had:

| Key | Meaning |
| --- | --- |
| `reply_to` | the id of the comment this one replies to, or `null` |
| `reply_to_request` | the `request_id` of the question this one replies to, or `null` |
| `by_person` | `true` when the call that wrote it came through the interface, `false` for any other call, `null` when the row has no call: one older than call identity, or written by a launch |
| `resolution` | the resolved mark, `{at, by, by_person, text}`, or `null`; always `null` on a reply |

A resolved root:

```json
{"id": 41, "kind": "comment", "author": "codex", "by_person": false,
 "body": "The export leaves out step claims.", "at": "2026-11-03T09:00:00.000000Z",
 "report": null, "checklist_item_id": null, "checklist_item_text": null,
 "reply_to": null, "reply_to_request": null,
 "resolution": {"at": "2026-11-03T11:30:00.000000Z", "by": "user", "by_person": true,
                "text": "Moved to MAIN-14"}}
```

A reply to it, and a reply under a question:

```json
{"id": 44, "kind": "comment", "author": "user", "by_person": true,
 "body": "Only the claims, the steps are there.", "at": "2026-11-03T09:20:00.000000Z",
 "report": null, "checklist_item_id": null, "checklist_item_text": null,
 "reply_to": 41, "reply_to_request": null, "resolution": null}
{"id": 45, "kind": "comment", "author": "codex", "by_person": false,
 "body": "Does the second option include the docs?", "at": "2026-11-03T09:25:00.000000Z",
 "report": null, "checklist_item_id": null, "checklist_item_text": null,
 "reply_to": null, "reply_to_request": "7d1c2a9e-3f4b-4c5d-8e6f-0a1b2c3d4e5f",
 "resolution": null}
```

**Writing a reply.** `comment_work_item`, its HTTP write
`POST /api/planning/work-item/comment` and the `comment` group of
`apply_work_item_changes` take two optional fields, `reply_to` (a comment id)
and `reply_to_request` (a question's `request_id`); naming both is refused with
`invalid_request`, and so is a parent on another item. The answer adds the root
the reply landed under, and both keys are `null` for a new root:

```json
{"work_item": "MAIN-12", "comment_count": 9, "comment_id": 46,
 "reply_to": 41, "reply_to_request": null}
```

`report_work_item` takes no parent. A reply, like a comment, writes no history
event and changes no revision. A reply in a resolved thread leaves the mark in
place; to reopen the discussion of a resolved root, write a new root that names
it.

**The resolved mark.** A root comment or report can be marked resolved, with a
short decision of one line and at most 280 characters, which may be empty. A
reply cannot, and a question's thread has none: a question has its own status.
`resolve_work_item_comment` and `POST /api/planning/work-item/comment/resolve`
take:

```json
{"id": "MAIN-12", "comment_id": 41, "resolution": "Moved to MAIN-14", "author": "codex"}
```

`resolution` may be left out, which is a blank decision. `reopen: true` in place of
`resolution` removes the mark; naming both is refused with `invalid_request`, and so
is a decision of two lines. The answer names the root and its mark as it now stands,
`null` after a reopen:

```json
{"work_item": "MAIN-12", "comment_id": 41,
 "resolution": {"at": "2026-11-03T11:30:00.000000Z", "by": "codex", "by_person": false,
                "text": "Moved to MAIN-14"}}
```

Marking a resolved root again replaces its decision and is recorded as a new
mark; reopening a root that has no mark writes nothing. A reply and a comment of
another item are refused with `invalid_request`, and a comment that does not exist
with `not_found`. The mark is not a field of the item: it changes no revision and
takes no `expected_revision`. It writes a history event, `comment_resolved`
with the detail `<comment id>: <decision>`, the id alone for a blank decision, or
`comment_reopened` with the detail `<comment id>`, so the history says who set
and removed it and when. The tool is a write like any other, and its answer
carries `from_person`. A mark set in the interface is a person's act and is told
to the agent working the item (see
[What a person did reaches the agent](#what-a-person-did-reaches-the-agent)).

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
| is exactly `/open/questions` | as for an item, but the panel of open questions in place of a card; see [The panel of open questions](#the-panel-of-open-questions) |
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

### The panel of open questions

`/open/questions` is reserved. A reference always ends in `-<number>`, so no item can
be spelled this way, and only this exact lowercase word is reserved: `/open/QUESTIONS`
gets the app page with `404`. It reads no store. Its route is
`/modules/planning/global?panel=questions`, and it reaches the desktop app and the
browser under the same conditions as a card.

`panel=questions` is an order to the page, not part of a route. The page opens the panel
and takes the parameter out of the address, so a reload or Back does not open it again
after it was closed. A window already showing a current page opens the panel over what
it shows and does not move, so a draft stays where it is.

The panel holds the questions that wait for a person. A
[list on a comment](#a-list-on-a-comment) waits for nobody, so the panel neither
shows nor counts one.

### The card's waiting question

`/open/<reference>?reveal=question` leads to the card as the plain address does, under the
same conditions, and asks it to go on to the question still waiting there. The route gets
`&reveal=question`, written by the server and never copied from the request. Any other value
or a repeated key is dropped and the card opens as usual; the rest of the query never reaches
the route, and `/open/questions` ignores the parameter.

This is an order to the page too. The page takes it out of the address before it obeys, so a
reload or Back opens the card without moving. It obeys once the card, its chain and a fresh
read of its questions have answered: the question comes into view under the tabs with the
keyboard on its first field, whichever section the card showed. A question answered or closed
by then leaves the card simply opened. A window already on this card obeys though its address
does not change, and a window on another card asks about a draft first and drops the order if
the draft is kept.

A [list on a comment](#a-list-on-a-comment) is not a waiting question: the order never
leads to one, and a card whose only pending question is a list opens simply.

### The `valkama:` scheme

The desktop installer registers `valkama:` for the user in `HKCU\Software\Classes` and
an uninstall removes it. A Windows notification opens it, because a click must work
after the process that showed the notification has exited and with nothing listening on
the port: the app starts the server itself. Without the app there are no notifications,
so there is no fallback through a browser.

The app takes three addresses and treats a page calling the scheme like any other caller:

| Address | What the window does |
| --- | --- |
| `valkama://open/<REFERENCE>` | opens the card; the reference is in upper case, as Valkama writes it |
| `valkama://open/<REFERENCE>?reveal=question` | opens the card at its waiting question; a notification about a question opens this |
| `valkama://open/questions` | opens the panel of open questions |

Anything else is refused: another host, an extra path, any other query, a fragment, a percent
escape, a lower-case reference, or a command line holding a second address. The process
exits without a window and does not raise a running one. Windows starts the app before
anything can read the address, so a refused launch still starts a process briefly.

The app knows only the number, so it reads the card's route from
`/open/<REFERENCE>?in=browser`, with `&reveal=question` when the address asked for it, which
starts nothing. At first start the window loads
that address. A page already up asks for it and moves with its own router, as it does
for a route the listener hands over; a number that leads nowhere is shown by the app page
at that address.

### Windows notification routes

Reads answer under the `Host` rule alone, because an agent's session holds no browser
credential. Writes take the browser's credential and, like every JSON write here, need
`Content-Length` and `Content-Type: application/json` with a JSON object for a body. A
`POST` without a length gets `411`, and one with an empty body and no type, which is what
a bare `fetch` sends, gets `415`: send `{}` where there is nothing to say.

| Route | What it does |
| --- | --- |
| `GET /api/alerts/settings` | the owner's settings: `enabled`, `events`, `content`, `locale` |
| `PUT /api/alerts/settings` | replaces them; an unknown key is refused and a missing one takes its default |
| `GET /api/alerts/status` | `shortcut`, `helper`, `autostart` and `windows`, which is what Windows says. Its first use may compile the helper, and it waits up to five seconds for Windows |
| `POST /api/alerts/test` with `{}` | shows a trial notification, and answers what Windows said with `shown` |
| `POST /api/alerts/presence` | a page reports `{page_id, focused, work_item_id, hub_open}`; a report counts for 30 seconds and is kept in memory only |
| `GET /api/alerts/presence?work_item=<id>` | `{"visible": <bool>}`, whether a focused page shows that item; with `hub=1` the panel of open questions counts too |

The last read is what a process asks before it shows a notification, and it gives up
after 150 ms, which reads as nothing being visible. An on-demand listener answers it with
`false` without loading the server
([`SERVICE.md`](../SERVICE.md#holding-the-port-from-login)).

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

### How much work an item took

A server listening for connections reads the clients' transcripts in the background
into usage rows: how long an agent actually worked, on which item, with which model,
and what its requests spent. A live item's numbers are about a minute old, and history
fills in at a second of reading every six. No message or command text is stored.

The time between two neighbouring records of one transcript counts as work, except:

| Left out as | When |
| --- | --- |
| `human` | a turn ended and the next thing is a person's prompt; a question to a person, from its call to its answer; a permission request until the call goes on |
| `subagent` | a coordinator waiting for a subagent, whose own transcript carries that time. A subagent with no transcript of its own leaves it with the coordinator, as work |
| `external` | after an API error until the next reply, and a wait for the model over 600 s |
| `gap` | what falls outside the server's liveness intervals, and everything between the last record of a run that fell and the next one |

Waiting for a script counts, including a background command from its start to its
notice, even when the turn ended meanwhile, for at most three hours from its own start: past
that it is a server left running rather than a script anyone waits for, and the wait is left
out as a turn's that ended. A background command that never sends a notice counts only up to
the end of its turn.

A server ticks once a minute. Ticks no more than 180 s apart make one liveness interval
in a file beside the store, `<store>.liveness`: a gap in them means the machine was off
or asleep or no server ran, so no work was observed. Time from before the first tick
has no such record. It is marked `estimated`, and each gap in it counts for 900 s at most.

Every stretch of work and every token goes to at most one item, by the first of these
signals that answers:

| Signal | Who | What it means |
| --- | --- | --- |
| `next_write` | any | the agent's next write in the same turn names the item |
| `last_write` | any | the last write in the same turn named it |
| `earlier_write` | any | a turn with no write: the agent's last write before it named it |
| `held_step` | subagent | it holds an open step of the item |
| `packet_number` | subagent | the first item number in its first prompt names the item |
| `label_number` | subagent | the first item number in its launch description does |
| `single_hold` | any | the session holds this item and no other |

What none of them places has no item and stands as a line of its own in a session's
read. A stretch of a turn still running reads under the item the rule gives so far, and
a later write in that turn moves it there.

`GET /api/planning/work-item/usage?id=<reference or work_item_id>&scope=item|chain|epic`
reads one item, or with `chain` or `epic` the item with the members
[its chain](#reading-a-chain-of-work) has in that scope. `GET
/api/planning/session/usage?session_id=<id>` reads one session with its subagents. Each
answers with `interface_version` and `usage`:

| Field | What it holds |
| --- | --- |
| `elapsed_seconds` | the union of the rows: two agents working one hour side by side on one item took one hour. Between items an overlap is real parallel work, so items may add up to more than their session or epic |
| `agent_seconds` | the sum of the rows: those two agents spent two hours. This one always adds up |
| `tokens` | `input`, `cached_read`, `cache_write_5m`, `cache_write_1h`, `output` and `reasoning`, each `null` when no request reported that kind. `input` excludes the cache at both clients. `reasoning` is the part of `output` spent on reasoning. `cache_write_5m` holds a client's shorter cache retention and `cache_write_1h` its longer |
| `estimated_api_cost_usd` | what the requests would cost at public API prices, per request, since a price depends on a request's size; `null` when no request has a known price |
| `cost_basis` | what that number is: an estimate, and not a bill, since a subscription pays differently |
| `unpriced_models` | models that spent tokens and have no known price. They add nothing to the cost, so a cost is as complete as this list says |
| `agents` | by run: `session_id`, `agent_id` (`null` for the session's own), `seconds`, `tokens`, `estimated_api_cost_usd` |
| `models` | `model`, `seconds`, `tokens`, `estimated_api_cost_usd`. A model only called on the side has no seconds of its own |
| `signals` | `signal` (`null` for no item), `seconds` and `share` of the time |
| `quality` | `observed`, `estimated`, `mixed`, or `null` when no time was counted; `estimated_seconds` says how much |
| `by_item` | one line per item: `work_item_id`, `reference`, `title`, `elapsed_seconds`, `agent_seconds`, `tokens`, `estimated_api_cost_usd`. A chain's starts at its root and lists every member; a session's lists the items it worked on, then its line with no item, whose `work_item_id` is `null`. An item since deleted keeps its id, with a `null` number and title |

An item's read adds `work_item_id`, `reference`, `title` and `scope`. A session's adds
`session_id`, `first_at`, `last_at`, `excluded` (`human`, `subagent`, `external` and
`gap` in seconds) and `runs`, one per transcript: `agent_id`, `client`, `status`
(`reading`, or `missing`, `truncated` or `unreadable` for one that cannot be read now),
`first_at`, `last_at`, `read_at` and its own `excluded`. For any run, work and
`excluded` add up to its span. A session not read yet reads empty rather than unknown.

The tools an agent calls do not carry these numbers: they would cost it context.

### The live-work frame

One small read says where work is going on now, across every space of the primary
store. The interface's side panel draws it, and the picker of
[mentions](#mentions) offers its rows first. It reads every open item and every
[pinned](#pins) one in one query and gives each the state a graph moves by
(`working`, `held`, `waiting` or `quiet`). It carries no history and no time that
moves, so a store in which nothing changed gives the same frame. Attached stores
are not read.

```json
{"spaces": [{"key": "MAIN", "name": "Main", "project_id": "example-project", "unplaced": 2,
   "rows": [
     {"reference": "MAIN-4", "title": "Structured answers", "kind": "epic", "parent": null,
      "state": null, "agents": 0, "quiet_since": null, "pinned": false,
      "state_name": "Dev", "is_terminal": false},
     {"reference": "MAIN-12", "title": "Answer a review in one form", "kind": "task",
      "parent": "MAIN-4", "state": "working", "agents": 2, "quiet_since": null,
      "pinned": false, "state_name": "Dev", "is_terminal": false},
     {"reference": "MAIN-13", "title": "Tell other work", "kind": "task",
      "parent": "MAIN-4", "state": "quiet", "agents": 0,
      "quiet_since": "2026-11-03T18:02:11Z", "pinned": false,
      "state_name": "Dev", "is_terminal": false},
     {"reference": "MAIN-7", "title": "Old migration", "kind": "task", "parent": null,
      "state": null, "agents": 0, "quiet_since": null, "pinned": true,
      "state_name": "Done", "is_terminal": true},
     {"reference": "MAIN-20", "title": "Notes for the owner", "kind": "task",
      "parent": null, "state": null, "agents": 0, "quiet_since": null, "pinned": true,
      "state_name": "Backlog", "is_terminal": false}]}],
 "elsewhere": 0}
```

| Field | What it holds |
| --- | --- |
| `key`, `name`, `project_id` | the space, and the project that binds it; `project_id` is `null` when none does |
| `unplaced` | how many agents are at work in this space on no row: a session at work none of whose work is a row counts once, and each of its live subagents once more |
| `rows` | the space's rows, in the order they are drawn |
| `elsewhere` | the same count for sessions at work whose folder lies under no space |
| `reference`, `title`, `kind` | the item |
| `parent` | the reference of the item's parent, which is then a row of the same space, or `null` |
| `state` | the live state: `working`, `held`, `waiting`, `quiet`, or `null` for a row with no live work |
| `agents` | the live subagents placed on this item, by the order usage counts by (see [How much work an item took](#how-much-work-an-item-took)), each on one item; a session's own run is not counted, since `state` already says it |
| `quiet_since` | for a `quiet` row, when its session last gave a sign of life; `null` otherwise. It does not move while the row stays quiet |
| `pinned` | whether a person pinned the item |
| `state_name`, `is_terminal` | the item's workflow state, as a link names the state of its other end |

**Which rows.** An open item whose state is `working`, `held`, `waiting` or
`quiet`; a pinned item, open or closed, whatever its state; and every parent of
those, so that `parent` always names a row. A `quiet` row is one whose session has
been silent for more than a day; it is shown, muted, so a claim nobody works on is
seen. Each item is one row, so an epic that is itself at work is its group's
heading with its own state. A space with no rows and nothing unplaced is not in
the frame.

**Order.** Spaces by key. In a space, a row that is another row's parent is a
group: the groups come first, in the [order of work](#the-order-of-work), each
followed by its own rows, and then the rows with neither a parent nor rows of
their own. Rows that are not groups stand by number, so a change of state does
not move a row, and a pinned row stands at its number among the others. The frame
is already in order; a client does not sort it.

**`unplaced` and `elsewhere`.** A session's space is the space bound to the
project whose root is the longest one that contains the session's
`opened_folder`, or else its `cwd`. A session whose folder lies under no root, or
under a project that binds no space, counts in `elsewhere`. This labels a counter
and nothing more: nothing is written, nothing is routed, and no binding is ever
inferred from a folder.

**How it arrives.** There is no route to poll. A stream opened with
`GET /api/events?view=planning`, with or without an exact scope, carries the frame
as an event of its own beside the space's read model, and `view=live` is a stream
that carries only that event:

```text
event: live
data: {"spaces": [...], "elsewhere": 0}
```

A stream sends the frame when it opens and again only when the frame differs from
the one it sent last. The frame is read from the primary store, not from the store
of the space the stream follows. It is computed at most once every 2 seconds and at
the stream's 60-second reread; a change that lands sooner is computed when the 2
seconds have passed. `view=live` takes no scope: with one it is refused as any view
other than `planning` is. A page whose space stream is open takes the frame from
that stream, and a page with none opens `view=live`, so a tab holds one stream.

### Pins

A person pins an item to keep it in the side panel whether or not anyone is
working on it. Pins live in the store, one per item, so the browser and the desktop
app show the same ones. Only the interface pins: no tool does.

`POST /api/planning/work-item/pin` takes the browser's credential and
`{"id": "MAIN-20", "pinned": true}`, or `"pinned": false` to remove the pin, and
answers with the [live-work frame](#the-live-work-frame) as it now stands. `id` is
a reference or a work item id of an item in the primary store; another is
`not_found` (404), and a `pinned` that is not a boolean is `invalid_request` (400).
A pin that is already as asked writes nothing.

A pin is the person's own list and not a change to the item: it writes no history
event, changes no revision and takes no `expected_revision`. The call is recorded
with its identity, as every write is, and it is never told to an agent: it is not
in `from_person`, in a notice or in a wake.

A pin outlives the item's close. A pinned closed item stays a row, with
`is_terminal: true`, until a person removes the pin; reopening the item makes it an
open row again. A merge gives the survivor the pins of the items merged into it, a
deleted item takes its pin with it, and an export carries the pins as
`planning.pins`, each `{"reference": "MAIN-20", "work_item_id": "…", "pinned_at": "…"}`.

### Several changes in one call

`apply_work_item_changes` applies several writes to one item in one call, all or
nothing. It takes `id`, `author`, `expected_revision`, `verbose` and any of
these groups, and applies them in this order:

| Group | Shape | Works as |
| --- | --- | --- |
| `claim` | `true` | `claim_work_item`; `false` is no change |
| `update` | `{title?, description?, labels?, priority?, rank?, kind?, parent?, source?}` | `update_work_item` |
| `checklist` | `{items, force?}`, each step text or `{text, done?}` | `set_work_item_checklist` |
| `checklist_ticks` | list of `{item_id, done?}`, `done` true by default | `tick_work_item_checklist_item` |
| `refs` | list of `{kind, value, label?}` | `attach_work_item_ref` |
| `links` | list of `{other, kind, remove?}`, linking from this item | `link_work_items` |
| `comment` or `comments` | `{body, checklist_item_id?, reply_to?, reply_to_request?, list?, mentions?}`, or a list of them | `comment_work_item` |
| `resolutions` | list of `{comment_id, resolution?, reopen?}` | `resolve_work_item_comment` |
| `questions` | list of `{kind, prompt, fields, expires_at?, execution_id?, session_id?}` | `create_work_item_request` |
| `summary` | `{done, next, why?, list?}` | `set_work_item_summary` |
| `transition` | `{state, reason?, force?, rank?}` | `transition_work_item` |

Each step is the write its single tool makes, with the same guards, events,
revision bumps and refusals, so a closing transition is judged after the ticks
and the summary sent with it. The call is still one write: what its earlier
groups wrote does not count as the agent having read what a person did, so a
`comment` sent beside a closing `transition` does not lift the
[`person_spoke` guard](#a-close-over-what-a-person-did).

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
It belongs to the call: `update` takes none of its own.

`update` edits the item as `update_work_item` does: a field that is absent or
null is left alone, `parent: ""` clears the parent, and an edit writes no
history event. It is applied after the claim, so a `rank` names a place among
the items of the state the claim started the item in.

`comments` writes up to 100 comments in the order sent, each as
`comment_work_item` writes it. The older `comment` group, one comment, still
works; a call that names both is refused with `invalid_request`. A parent named
in `reply_to` must already exist when that entry is written: the id of a
comment the same call writes is not known to the caller, so a reply to it is a
second call. The same holds for `resolutions`.

`questions` asks up to 100 questions, each with what `create_work_item_request`
takes and checked by the same rules. Each is the single tool's question: it
waits in the owner's list and raises the owner's alert once the call is
committed. A call that asks a question and closes the item with its
`transition` is refused, `invalid_request` on the `transition` step, and
`force` does not carry it: a closed item reads a waiting question `expired`, so
it would be asked and lost in one write. Move the item to review, or leave the
question out. A question asked by an earlier call does not stop a close, as it
never did. A closed item takes no question, and `questions` is applied before
`transition`, so a call that reopens an item cannot also ask on it.

The steps run inside one transaction. When one is refused, none of them is
written, and the error body keeps the refusal's code, prefixes its message with
the step, and names the step:

```json
{"error": {"code": "workflow_guard",
 "message": "transition: [checklist] WIR-3 has 1 open checklist step(s); …",
 "step": {"group": "transition", "index": 0}}}
```

`index` is the entry's position in a list group and 0 for the others. An entry
refused for its shape, one that is not an object or names a field its group
does not take, is named the same way. A refused
stale revision keeps `expected` and `actual` beside it. The call is recorded as
one call with its identity, and every row its steps write points to that call.

The acknowledgement's `applied` names only the groups that changed something.
`update` lists the fields sent, as `update_work_item` answers in `updated`;
`comments` and `questions` list every comment and question the call wrote, so
a reply or a withdrawal needs no read first. A comment or a summary that carried a
[list](#a-list-on-a-comment) adds its `list_request_id`, and a comment that named
other items adds who will hear them as [`mentions`](#mentions):

```json
{"claim": true, "update": ["title", "priority"],
 "checklist": [{"item_id": "…", "text": "write it", "done": false}],
 "checklist_ticks": [{"item_id": "…", "done": true}], "refs": 1, "links": 1,
 "comments": [{"comment_id": 41, "reply_to": null, "reply_to_request": null}],
 "questions": [{"request_id": "…", "revision": 0}],
 "summary": {"summary_comment_id": 42}, "transition": {"state": "review"}}
```

The single tools stay as they are. The batch is also the HTTP write
`POST /api/planning/work-item/apply`, which takes the same body and answers with
the full item and `applied`.

**Since 2.5.** The `comment` group takes a parent as `comment_work_item` does,
and `applied.comment` then carries `reply_to` and `reply_to_request` beside
`comment_id`. The `resolutions` group, applied after `comment` and before
`summary`, sets or removes the resolved mark on up to 100 roots of the item in
one call, which is how a digest is reviewed in one write; one refused entry
writes none of them. `applied.resolutions` lists each root's mark as it now
stands:

```json
{"comment": {"comment_id": 61, "reply_to": null, "reply_to_request": null},
 "resolutions": [{"comment_id": 41, "resolution": {"at": "2026-11-03T11:30:00.000000Z",
   "by": "codex", "by_person": false, "text": "Review 2026-11-03"}},
  {"comment_id": 43, "resolution": null}]}
```

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
  answered there; a [list](#a-list-on-a-comment) goes with the comment it stands
  under, so the list of a report stays with the report on the merged item;
- **since 2.5**, comments move by thread: a comment root moves with its replies
  and its resolved mark, a report's thread stays with the report on the merged
  item, and the replies under a question move with the question. `moved.comments`
  counts the rows that moved;
- the refs, except one the survivor already has, which stays where it was;
- the [pin](#pins), which the survivor keeps when it has one already;
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
history, the [mentions](#mentions) of it, its reports, its description, labels and
parent. The
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
`POST /api/hooks/message-display` writes nothing, records no call and takes no
credential; it refuses `Origin` and `Sec-Fetch-Site` instead, see
[the hook contract](hook-contract.md#work-item-numbers-as-links-on-the-screen).

A write Valkama
makes on its own account, which today is only releasing an expired lease, is
`confirmed` with source `valkama`, client `valkama` and tool `lease-expiry`, and
its events are signed `valkama`.

A call row of an edit (`update_work_item`, `POST /api/planning/work-item/update`)
names in `reason` the fields it changed, comma-separated, as the columns are
named: `title`, `description`, `source`, `priority`, `labels`, `kind`,
`parent_id`. An edit logs no event, so this is the record that a person edited
an item rather than only moved it within its state; an edit that changed no
field, or only `rank`, leaves it null. Other Planning call rows leave it null.

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

The card's own read says more about who that was: `last_claim_executor` is the
same `executor` its claim, steps and agents carry, for the holder
`last_claim_ref` names, with `state` `none` when there is no session to open.

### What a person did reaches the agent

A person works in the interface and an agent through its tools, on the same item
and with no channel between them. So the next agent write to an item says what a
person did there that no agent has been told yet, and an agent cannot close the
item over it without saying so.

**Who is a person.** A write is a person's when its call came through the
interface: its call row's `identity_source` is `browser` and it went to a
Planning path (`/api/planning/...`). That is a fact about the call, not about the
name it is signed with, so an agent signing `author: "user"` is still an agent,
and a person's write signed with any name is still the person's. A launch writes
under the interface's credential too, but what it writes is the launch's, not
the person's words, and it is not counted.

**The window.** A person's writes count from the last write an agent made to the
item: any call row on that item that is neither `browser` nor `valkama`, found
through the item's events and comments, or through the call rows themselves for
a write that logs neither, an edit or a ref. A claim is such a write, so after a
claim only what came later counts, and before any agent wrote, everything a
person did since the item was made. The window keeps no state: an agent's write
moves it by being written, a refused write is rolled back and moves nothing, and
whichever agent writes next -- an orchestrator or its subagent -- is the one told,
once. Valkama's own release of a lapsed claim and a write made outside any call
are on neither side. An agent's write to another item -- the far end of a link, or
a comment there that [mentions](#mentions) this one -- does not move this item's
window. Order is the call rows' ids.

**What is told.** Each event, oldest first:

| Field | Meaning |
| --- | --- |
| `kind` | `comment`; `report` (a person recorded a summary); `status` (a state change, `text` the new key and any reason); `claimed`, `released`, `taken_over`; `edited`; `steps_edited`, `step_claimed`, `step_taken_over`, `step_released`, `step_completed`, `step_reopened`; `linked`, `unlinked`; `summary_selected` (an earlier report made current); `question_asked`, `question_answered`, `question_declined`, `question_withdrawn` |
| `via` | always `interface`: the one thing the store proves about who did it |
| `at` | when, as the row records it |
| `comment_id` | for `comment` and `report` |
| `request_id` | for the question kinds |
| `fields` | for `edited`: the fields it changed |
| `text` | what it said, at most 300 characters, the last one `…` when cut: a comment's body, a report's `done`, an answer as `label: choice` pairs and its note, or a review's summary (see [Reading a question](#reading-a-question)), the prompt of a question asked, declined or withdrawn, an edit's fields as they read now, a step's or a link's detail; absent when there is nothing to quote |

**Since 2.5**, four more kinds:

| `kind` | When | Also carries |
| --- | --- | --- |
| `reply` | a person replied in a thread; a new root is still told as `comment` | `comment_id`; `reply_to` or `reply_to_request`, the root; `text`, the reply |
| `thread_resolved` | a person marked a root resolved | `comment_id`; `text`, the decision |
| `thread_reopened` | a person removed the mark | `comment_id` |
| `question_changed` | a person changed a given answer | `request_id`; `text`, [what changed](#the-difference-between-two-answers), within the 300 characters |

```json
{"kind": "reply", "via": "interface", "at": "2026-11-03T10:12:00.000000Z",
 "comment_id": 57, "reply_to": 41, "text": "Agreed, take the second option."}
{"kind": "question_changed", "via": "interface", "at": "2026-11-03T12:00:00.000000Z",
 "request_id": "7d1c2a9e-3f4b-4c5d-8e6f-0a1b2c3d4e5f",
 "text": "changed: route flat→threads"}
```

All four count in the window and in the `person_spoke` guard as any act of a
person does.

One more kind is a person's words about this item written on another one:

| `kind` | When | Also carries |
| --- | --- | --- |
| `mentioned` | a person named this item in the `mentions` of a comment on another item (see [Mentions](#mentions)) | `comment_id`; `from`, the reference of the item that comment stands on; `text`, the comment |

```json
{"kind": "mentioned", "via": "interface", "at": "2026-11-05T20:31:00.000000Z",
 "comment_id": 61, "from": "MAIN-12", "text": "Decided to keep the old route; MAIN-14 can drop it."}
```

It counts in the window and in the `person_spoke` guard as the other kinds do. Another
agent's mention is never one of these events: it is an agent's words, and it reaches
the holders through the hook and the item's `mentions`, never through `from_person`.

The whole text is in `get_work_item` and `get_work_item_request`. Filing an item,
attaching a session and a recorded override are never told. A drag within a
state, or an edit that changed nothing, says nothing.

**On every agent write.** The answer carries the window as it stood before that
write, as `from_person`, and no key at all when it is empty. It holds the newest
20 events, and `from_person_omitted` counts the earlier ones it left out. It is
read inside the write's own transaction, so a person's write that lands while the
call runs is either in this answer or in the next window, never in neither. An
HTTP write answers without it, and no schema of the interface changed.

### A close over what a person did

An agent's transition into a terminal state, by `is_terminal`, is refused while
the window is not empty, with the guard `person_spoke`. The refusal names the
events, newest 20, with their text, so the agent can act on them. Writing
anything to the item first -- a comment saying what it did about them -- empties
the window and the close goes through; `force: true` carries it through as it
does every guard and records `overridden` with `person_spoke`, and the answer
still carries `from_person`. A `transition` group is judged the same way, with
the window counted from before the batch.

A person closing an item is not guarded, nor is a write made outside any call. An
item a person closed or cancelled is told to the agent by its next write's
`from_person`; writing to a closed item behaves as before. `merge_work_items`
judges each merged item before anything moves, because the merge moves its
comments to the survivor: a merged item with a non-empty window refuses the
merge with `person_spoke`, and `force` records it on that item once.

### Mentions

A number in a comment is a link and tells nobody: comments name other items all
the time. To tell the work on another item, a comment names that item in
`mentions`. The comment stays where it is written, and the item it names gets a
record that points to it.

**Writing.** `comment_work_item`, `report_work_item`, the HTTP write
`POST /api/planning/work-item/comment`, the `comment` group of
`apply_work_item_changes` and each comment where a batch writes several take
`mentions`, a list of items by reference or work item id, on a root and on a reply
alike. The text of the comment is not changed and is not read for references.

```json
{"id": "MAIN-12", "body": "Decided to keep the old route; MAIN-14 can drop it.",
 "mentions": ["MAIN-14", "MAIN-15"]}
```

A call through the interface names at most 20 items, any other call at most 5, and
a session mentions one item at most 3 times an hour. Refused before anything is
written:

| Case | Refusal |
| --- | --- |
| more items than the call may name | `invalid_request`: `mentions holds at most 5 items` (20 for the interface) |
| an item named twice | `invalid_request`: `mentions names MAIN-14 twice` |
| the comment's own item | `invalid_request`: `an item does not mention itself` |
| an item that does not exist | `not_found` |
| a fourth mention of one item within an hour by one session | `mention_limit`: `MAIN-14 was mentioned 3 times in the last hour by this session; write once there, or wait` |

The hour counts the mentions of that item whose confirmed call names the same
session, its subagents included. A call with no session, the interface's or an
unconfirmed one, is not counted, and an unconfirmed call tells nobody either. A
closed item can be mentioned: the record is written and nobody is told. Over HTTP,
`mention_limit` answers 429.

**What is written.** Each item named gets one history event, `mentioned`, whose
detail is the comment's id, under the call that wrote the comment. That call
belongs to the comment's item, so a mention does not move the
[window](#what-a-person-did-reaches-the-agent) of the item it names, as the far
end of a link does not.

**The answer** says who will hear, beside the comment's own keys:

```json
{"work_item": "MAIN-12", "comment_count": 10, "comment_id": 61,
 "reply_to": null, "reply_to_request": null,
 "mentions": [{"reference": "MAIN-14", "holders": ["claude (session 019a…)"]},
              {"reference": "MAIN-15", "holders": [],
               "told": "nobody yet: no holder, it stays on the item"}]}
```

`holders` are the holder of the item's claim and of each held step, as `claim_ref`
and `claimed_by` name them. `told` is there only when they will not hear it:
`nobody yet: no holder, it stays on the item`, `nobody: closed`, or `nobody: this
call proved no session`. A batch's `applied.comment`, and each entry of
`applied.comments`, carries the same `mentions`.

**Reading.** Every comment, in every read, carries `mentions`, the references it
named, `[]` when it named none. `get_work_item` carries `mentions`, the 5 newest
comments that named this item, oldest first, and `mentions_total`; with
`full: true` it carries all of them and no total. The HTTP item read carries the
newest 50 and the total, and so does every answer that is the whole item: the
HTTP writes and a tool's `verbose` answer.

```json
{"comment_id": 61, "from": "MAIN-12", "at": "2026-11-05T20:31:00.000000Z",
 "by_person": false, "author": "codex",
 "quote": "Decided to keep the old route; MAIN-14 can drop it."}
```

`from` is the reference of the item the comment stands on now, and `quote` the
first 300 characters of its body, or of a report's `done`, the last one `…` when
cut. When that comment went with a
deleted item, the record stays and both are `null`. `by_person` is read from the
call, as on a comment. The card of the item named shows each record as a quiet line
in its discussion, by time, leading to the comment; it is not a thread there, and
an answer goes in the comment's own thread.

**Who hears.** A person's mention is the person's act on the item named: it is a
`mentioned` event in [`from_person`](#what-a-person-did-reaches-the-agent), counts
in the `person_spoke` guard, and wakes an idle holder as any act of a person does.
An agent's mention is never a person's, whatever `author` it signs: it is not in
`from_person` and does not count in `person_spoke`. The holders hear it at their
next tool call, in a block of the notice of its own, and it never wakes a session
or continues a turn; who is told and when is in
[the hook contract](hook-contract.md#who-is-told). With nobody holding the item,
the record waits on it for whoever takes it next.

**Merging.** A record stays where it was written: the mentions of a merged item
stay on it and do not move to the survivor. A comment that moves in a merge keeps
what it named, and its records then name the survivor in `from`.

### Questions and decisions

`create_work_item_request` creates a persistent question or decision for one work
item. `get_work_item_request` and `list_work_item_requests` are read-only tools.
The answer, decline and expire tools take the request's own `expected_revision`;
it is independent of the work item revision. Only one concurrent resolution can
succeed. A closed task, ended bound execution or elapsed deadline prevents a
late answer. Reading effective expiry does not write to an attached store.

Fields have stable IDs and one of five types: `text`, `choice`, `multi_choice`,
`boolean` or `verdict`. A required boolean can be answered `false`; omission is
different. There is no implicit permission grant or automatic execution resume.

A field is `{id, label, type, required, options}` and may add four keys:

| Key | Value | Rule |
| --- | --- | --- |
| `description` | markdown of 1 to 8000 characters | on a field of any type: what the field asks, or the point it decides. The interface folds it as it folds an option's description |
| `group` | text of 1 to 200 characters | the fields of one group stand together, and the interface draws them as one section under that heading |
| `under` | `{field, option}` | the field is shown and answered only while the answer of `field` holds `option`; see below |
| `recommended` | `accept`, `later` or `reject` | on a `verdict` only; a `choice` and a `multi_choice` recommend on their options |

A question holds 1 to 40 fields, a field at most 20 options, and the fields of one
question fit in 64 KiB as stored; a refusal names the limit. What a field or an
option was not given it does not say on the way back, and a question written
without the four keys is what it always was. The published schema of
`create_work_item_request` names every key, so an agent reads them from the server
whatever its skill says.

**A verdict** is one line of a review: a point the person accepts, puts off or
rejects. Its `options` is `[]`, its answer is `accept`, `later` or `reject`, and the
interface names the three in the person's language. Like a `choice`, it takes an
own variant in place of the verdict, and a comment.

**A field under another** belongs to the answer of an earlier field, its parent:
the steps of an accepted point, the way of doing it, the detail of one option. The
parent is a `verdict`, `choice` or `multi_choice` field that stands earlier and is
under nothing itself, so there is one level. `option` is `accept`, `later` or
`reject` under a verdict, and one of the parent's option ids under a `choice` or a
`multi_choice`. A parent holds it when that is its verdict, its chosen option, or
one of its chosen options; an own variant holds none. The field stands in its
parent's group: it leaves `group` out or repeats the parent's. A schema stays flat:
a field under another is one more entry of `fields`, never nested in it.

While its parent does not hold `option`, the field is hidden. An answer gives a
hidden field nothing: no value, no own variant and no comment. A required field is
required only while it is shown. The parent is never worked out from what is
chosen under it: steps all left out under `accept` are an error to correct, not a
third state of the verdict.

Two points of a review, one with its steps and one with its way under `accept`:

```json
[{"id": "p4", "label": "P4 Checks: false alarms", "type": "verdict", "required": false,
  "options": [], "group": "Checks", "recommended": "accept",
  "description": "Fourteen refusals last week were false alarms."},
 {"id": "p4-steps", "label": "Steps", "type": "multi_choice", "required": true,
  "under": {"field": "p4", "option": "accept"},
  "options": [{"id": "p4a", "label": "Mark the 14 refusals, then narrow the rule", "recommended": true},
              {"id": "p4b", "label": "Check the claim against the file it names", "recommended": true},
              {"id": "p4c", "label": "Skip the check on an intermediate stop"}]},
 {"id": "p13", "label": "P13 A 400-line limit for .vue files", "type": "verdict",
  "required": false, "options": [], "group": "Web code", "recommended": "accept"},
 {"id": "p13-way", "label": "How", "type": "choice", "required": true,
  "under": {"field": "p13", "option": "accept"},
  "options": [{"id": "per_block", "label": "vue/max-lines-per-block", "recommended": true},
              {"id": "css_file", "label": "Styles in CSS files"},
              {"id": "split_first", "label": "Split the files first"}]}]
```

`recommended` is what the interface fills a draft from, and filling sends nothing.
Choosing `accept` on a verdict with a field under it fills that field once, the
first time: a `multi_choice` with its recommended options, or all of them when none
is, and a `choice` with its recommended option, or nothing. "Accept recommended"
gives every verdict still undecided its recommendation and leaves what the person
already chose.

Each refusal names the field and how to put it right, with `invalid_request` and
nothing written:

| Mistake | Refusal |
| --- | --- |
| options on a verdict | `field p1: a verdict takes no options; put steps or ways in a field with under: {field: p1, option: accept}` |
| a parent no earlier field is | `field p4-steps: under names p4, which no earlier field has; a parent stands before its children` |
| a parent of another type | `field p4-steps: under names p4, a text field; a parent is a verdict, choice or multi_choice field` |
| an option the parent lacks | `field p4-steps: p4 is a verdict, so under.option is accept, later or reject`; `field web-detail: option x is not an option of areas` |
| more than one level | `field x: under names y, which stands under z; one level: put it under z` |
| another group than the parent's | `field p4-steps: a field under p4 stands in p4's group; leave group out` |
| `recommended` on a field that is no verdict | `field p11: recommended on a field is for a verdict; in a choice put it on the option` |
| a group split by another | `group Checks is split by Web code: fields of one group stand together` |
| more than 40 fields | `fields must contain between 1 and 40 fields` |
| a key a field does not take | `each field requires id, label, type, required and options and may add description, group, under and recommended` |

A field without a group between two fields of one group splits it as well, and the
refusal names that field: `group Checks is split by p7, which has no group: fields
of one group stand together`. An answer is refused the same way:

| Mistake | Refusal |
| --- | --- |
| a value, own variant or comment for a hidden field | `answer p4-steps stands under p4=accept, and p4 is later; leave it out` |
| a required field left empty while it is shown | `answer p4-steps is required because p4 is accept; give an option or your own variant in own` |
| a verdict that is none of the three | `answer p1 is accept, later or reject` |

In the first, the parent reads as its answer: its verdict, its chosen option ids,
`own variant`, or `unanswered`.

An option is `{id, label, description?, recommended?}` and takes no other key.
`description` is markdown of 1 to 8000 characters and `recommended` a boolean, true
on at most one option of a `choice` and on any number of a `multi_choice`.

`answer_work_item_request` and `POST /api/modules/planning/request/answer` take
`answers` and an optional `note` of at most 8000 characters. A comment over an open
question is not an answer, and neither is a reply in its thread.

**Since 2.5**, an answer has four parts, each optional where the field allows it:

| Part | Shape | Meaning |
| --- | --- | --- |
| `answers` | `{field: value}` | the chosen option, options or text of a field |
| `own` | `{field: text}`, at most 8000 characters each | the person's own variant of a `choice`, `multi_choice`, `boolean` or `verdict` field. It replaces the choice of a `choice`, `boolean` or `verdict` field, so that field takes one or the other, and stands beside the chosen options of a `multi_choice`. A `text` field has none: its text is already free |
| `field_notes` | `{field: text}`, at most 2000 characters each | a comment on any field but a `text` one, which is refused: its text is its own comment |
| `note` | text, at most 8000 characters | a comment on the whole question |

A required field is answered when it has a value or an own variant, and every
part that is given is checked against its field. **The note no
longer stands in for required fields**: an answer that leaves one out is refused,
naming it, with `answer <field> is required; give an option or your own variant in
own; a note no longer stands in for a field`. An answer given before 2.5 with a note
in place of a field stays as it was written and reads as that field unanswered and
a comment on the question.

A question stays a request and writes no comment. The answer in force is kept in
`answers_json` as one flat object, with three keys no field id can take: `_own`,
`_notes` and `_note`.

```json
{"route": "threads", "areas": ["ui", "mcp"],
 "_own": {"release": "In a week, after acceptance"},
 "_notes": {"route": "Threads serve the digest too"},
 "_note": "A comment on the whole question"}
```

A review is answered just as flat. A verdict's value is its word, a field under
another is one more key, and a point's comment and own variant are the field's:

```json
{"p1": "accept", "p12": "later", "p15": "reject",
 "p4": "accept", "p4-steps": ["p4a", "p4c"],
 "p13": "accept", "p13-way": "per_block",
 "_notes": {"p15": "Frozen until spring"}, "_own": {"p9": "Labels only, no filtering"}}
```

So a comment on one point, an own variant, versions, search and export work on a
review as on any question.

Every read gives the parts apart, as `answers`, `own`, `field_notes` and `note`,
with `note: null` when there is none. A
reader that opens `answers_json` itself, or a build from before 2.5, sees those
keys among the answers.

**Changing an answer**, since 2.5. A given answer can be changed while its item is
open, by a person or by an agent: `answer_work_item_request` with `change: true`,
or `POST /api/modules/planning/request/change` (`/api/planning/request/change` on
the neutral boundary). The body is the answer's, with the request's
`expected_revision` required:

```json
{"project_id": "example-project", "data_scope_id": "…", "space_key": "MAIN",
 "id": "7d1c2a9e-3f4b-4c5d-8e6f-0a1b2c3d4e5f", "expected_revision": 2,
 "author": "user", "answers": {"route": "threads"},
 "field_notes": {"route": "Threads serve the digest too"}}
```

A change gives the whole new answer: a part it leaves out, an own variant or a
comment, is not carried over from the answer it replaces. A change keeps the replaced answer as a version, writes the new one in its place,
raises `answer_version` and the request's `revision`, moves `resolved_at` to the
time of the change and writes the history event `request_changed` with the
request's id as its detail. A reader that asks with `answered_after` therefore
gets a changed answer as a new one. Refused, with nothing written:

- an answer equal to the one in force, with `invalid_request` (`unchanged`); the
  options of a `multi_choice` are a set, so the same ones in another order are equal;
- a request that is not answered, an item that is closed, and a request with 50
  versions, with `workflow_guard`;
- a stale `expected_revision`, with `revision_conflict`.

An answer without `change` is still given once: a second one is refused with
`workflow_guard`. Who changed it is in `by_person` of each version.

#### The difference between two answers

A change is told and shown as what it changed, row by row: two whole answers of a
review do not fit in one notice. One rule makes the difference, on the server for
the text of `question_changed` and in the card for its previous answers, and the
example below holds both to it.

The difference compares the two answers field by field, in the order of the
fields, and then the note on the whole question. Each part of a field that differs
is one row, its value first, then its own variant, then its comment:

| What differs | The row reads |
| --- | --- |
| the value of a `verdict`, `choice` or `boolean` | `p12 later→accept`, the ids or words as stored; no value on one side is `—`: `p17 —→accept`, `p13-way per_block→—` |
| the options of a `multi_choice` | `p10-steps +lock −glob`: the added ones, then the removed ones, each in the order the field offers them |
| the text of a `text` field | `scope rewritten` |
| an own variant | `p9 own variant: Labels only` when given or changed; `p9 own variant removed` |
| a field's comment | `p15 comment: Frozen until spring`; `p15 comment removed` |
| the note on the question | `note: Ship it after the docs`; `note removed` |

A quoted own variant, comment or note is cut at 60 characters, the last one `…`.
The text of `question_changed` is `changed: ` and the rows joined by `; `, within
300 characters: rows that do not fit are left out from the end and counted, as
`; and 4 more`. The card draws the same rows in the same order in the person's
words, with labels in place of ids, for a question it draws as a review (one with a
`group`, or with more than 8 verdict fields); it shows any other question's versions
whole, as before.

The replaced answer and the one in force:

```json
{"p1": "accept", "p10": "accept", "p10-steps": ["glob", "scan"], "p12": "later", "p15": "reject"}
{"p1": "accept", "p10": "accept", "p10-steps": ["scan", "lock"], "p12": "accept", "p15": "reject",
 "_notes": {"p15": "Frozen until spring"}}
```

with `p10-steps` offering `glob`, `scan` and `lock` in that order, differ in three
rows, and `question_changed` says:

```text
changed: p10-steps +lock −glob; p12 later→accept; p15 comment: Frozen until spring
```

#### Reading a question

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
that it leaves out the labels first, every row's `label` then reading `null`, and
only then its later fields, so a reader learns every field that was answered
before it loses one. An item that lost anything
this way carries `clipped: true`, and one that lost nothing has no such key. The
whole text is in `get_work_item_request` and in the list with `full: true`.

**Since 2.5**, a row of `answer` carries `own` and `note` (the field's comment) when
there are any, and a field answered only with its own variant has a row with
`value: null`. A question carries `answer_version`, `replies` (how many replies
its thread has) and `last_reply` (as a thread root carries it, or `null`), and from
version 2 on `previous`, the version the answer in force replaced:

```json
{"id": "…", "status": "answered", "question": "Which way?",
 "answer": [{"field": "route", "value": "threads", "label": "Threads",
             "note": "Threads serve the digest too"},
            {"field": "release", "value": null, "label": null,
             "own": "In a week, after acceptance"}],
 "note": "A comment on the whole question", "answered_by": "user", "by_person": true,
 "answered_at": "2026-11-03T12:00:00.000000Z", "answer_version": 2,
 "previous": {"answer": [{"field": "route", "value": "flat", "label": "Flat"}],
              "note": null, "answered_at": "2026-11-03T09:00:00.000000Z"},
 "replies": 1, "last_reply": {"id": 45, "author": "codex", "by_person": false,
   "at": "2026-11-03T09:25:00.000000Z", "body": "Does the second option include the docs?"}}
```

`answered_at` is when the answer in force was given; the first answer's time is that
of version 1. `previous` is the first thing left out when a question runs past 2000
characters, before any label, and its loss is marked with `clipped` as any other.

**A review in the compact form.** A question with a `verdict` field carries two
keys more, and its `answer` holds only what says more than a verdict does:

```json
{"id": "…", "status": "answered", "question": "Decisions on the review of the checks",
 "verdicts": {"accept": ["p1", "p4", "p13"], "later": ["p12"], "reject": ["p15"]},
 "undecided": ["p17"],
 "answer": [{"field": "p4-steps", "under": "p4", "of": 3, "value": ["p4a", "p4c"], "label": null},
            {"field": "p9", "value": null, "label": null, "own": "Labels only, no filtering"},
            {"field": "p13-way", "under": "p13", "value": "per_block",
             "label": "vue/max-lines-per-block"},
            {"field": "p15", "value": "reject", "label": null, "note": "Frozen until spring"}],
 "note": null, "answered_by": "user", "by_person": true,
 "answered_at": "2026-11-05T18:40:00.000000Z", "answer_version": 1,
 "replies": 0, "last_reply": null}
```

- `verdicts` names every verdict field that was given a verdict, under its word.
  All three words are always there, with `[]` for one nobody chose.
- `undecided` names every verdict field that is shown and was given neither a
  verdict nor an own variant, `[]` when there is none. A verdict with an own variant
  is decided: it is in neither list and has a row in `answer`. A hidden verdict field
  is in neither.
- `answer` has a row for each field under another, each verdict with a comment or an
  own variant, and each field of another type, as any question has. A verdict with
  neither has no row: `verdicts` already says it.
- A row of a field under another carries `under`, its parent's id. A `multi_choice`
  under another carries `of`, how many options it offers, and never a label, so its
  steps read as "2 of 3" and labels do not crowd out rows; they are in
  `get_work_item_request`.
- The two lists stand whole before any row, and past 2000 characters only rows are
  lost, labels first. Forty ids near their 64-character limit can fill the room
  alone: the question then has no rows and `clipped: true`.
- `previous` has the same shape: `verdicts`, `undecided`, `answer`, `note` and
  `answered_at`.

A question without a verdict field has neither key and reads as above.

The whole form -- `get_work_item_request`, the list with `full: true`, an export and
the interface's reads (`GET /api/modules/planning/request` and
`GET /api/modules/planning/requests`) -- carries, since 2.5, `own`, `field_notes`,
`answer_version` and `history`. `own` and `field_notes` are `null` while `answers`
is, and `{}` for an answer without them. `answer_version` is 0 with no answer, 1 for
the first one and one more for each change. `history` holds the replaced versions,
oldest first, `[]` when there is none:

```json
{"request_id": "7d1c2a9e-3f4b-4c5d-8e6f-0a1b2c3d4e5f", "status": "answered",
 "answers": {"route": "threads"}, "own": {"release": "In a week, after acceptance"},
 "field_notes": {"route": "Threads serve the digest too"},
 "note": "A comment on the whole question", "answer_version": 2,
 "answered_by": "user", "by_person": true, "resolved_at": "2026-11-03T12:00:00.000000Z",
 "revision": 3,
 "history": [{"version": 1, "answers": {"route": "flat"}, "own": {}, "field_notes": {},
              "note": null, "answered_by": "codex", "by_person": false,
              "answered_at": "2026-11-03T09:00:00.000000Z"}]}
```

(The request's other keys are as before and left out here.) A version's
`by_person` is read from the call that gave it, and is `null`, as on a comment,
for a version no call gave: one older than call identity, or written by a launch.
The answer in force takes its `by_person` from the latest `request_answered` or
`request_changed` event.
`get_work_item_request`, and its HTTP read `GET /api/planning/request`, also carry
`replies`: the question's whole thread, as comments in the flat form. No other read
of a question carries it: the interface and an export read those replies among the
item's comments, where they are not duplicated. `answer_text`, the one line a notice
and a refusal quote, includes own variants and comments.

Every whole read of a question also carries `comment_id`: the comment a
[list](#a-list-on-a-comment) stands under, and `null` for any other question. The
compact form carries it only on a list.

For a question with a `verdict` field, `answer_text` is a summary that fits a
notice: the verdict most fields have, as a count, then the other two by their
fields, each in the order accept, later, reject; then the own variants, the fields
under another (a `multi_choice` as chosen/offered, a `choice` as its option id),
any other field as `label: choice`, the undecided fields and the note. A comment
follows its field, and a commented field of the counted verdict is named after the
count, as `accept 15, p3 (comment: …)`. A tie for the count goes to the earlier
word. The answer above reads:

```text
accept 3; later: p12; reject: p15 (comment: Frozen until spring); p9 own variant: Labels only, no filtering; p4-steps 2/3; p13-way: per_block; undecided: p17
```

`by_person` says whether the call that closed the question was a browser write, as
[above](#call-identity) defines it: true for one, false for any other call that
answered, declined or withdrew it, and null while no call has, which covers a question
still open, one that ran out by itself, and an answer written with no call, as on a
comment: one older than call identity, or written by a launch. Every read of a question has the key: the
HTTP reads a screen draws from, the answer of a write, the tools and an export. It is
read from that call's row, so no argument sets it, and `author` has no part in it: an
agent that signs as the owner reads `false`. It means "through the interface" and no
more. `GET /api/security/bootstrap` gives its token to any request with the fetch
metadata a browser sends, so a local process that sends them counts as the interface.
That is the boundary of local credentials, not a proof of who was at the keyboard.

`search_work_items` also reads a question's prompt, the labels and descriptions of
its fields and options, its answers and its note, and a row found that way carries
`question_hit`, the prompt. An option that was offered and not chosen is found too.
An export carries every question in `planning.requests`, whole. Since 2.5 a search
also reads own variants and field comments, and the decision of a resolved mark
with the comments.

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

An attached store is read as it is and never migrated, so one another build wrote
may lack a table or a column a read names. The stamp does not tell, since an added
table or column does not raise it; the read itself does. Such a read of a card
answers 409 with the code `store_schema_mismatch`:
`GET /api/modules/planning/work-item` in the state envelope
(`{"interface_version": "valkama-ui-state", "status": "unavailable", "reason":
"store_schema_mismatch"}`), and a read of the whole space, `GET /api/planning`, as
`{"error": {"code": "store_schema_mismatch", "message": "..."}}`. Neither carries
SQLite's words, and nothing is retried: asking again cannot change what the store
holds. A store that is busy or failing is not this refusal. `/open/<reference>`
still leads to such a card, because it asks only whether the item is there, and the
card says why it cannot be read. What such a store can answer it still answers: its
listing, the mapped search and its requests. To read its cards, open that file once
as the primary store with this build, which migrates it after its backup, or read it
with the build that wrote it. It covers a store a later build wrote only where that
build dropped what this one reads; a later build that changed what a row means is
not told apart. No MCP tool opens an attached store: an agent's connection is the
primary, where `get_work_item` for such an item answers `not_found`.

### A list on a comment

An agent that reports several findings can offer them as a list the person ticks,
under its own comment. The list is a question with one `multi_choice` field, and
the comment it stands under is its `comment_id`. Answering, changing an answer, an
own variant, a comment, `by_person`, search and export are a question's. What sets
a list apart is that nobody waits for it.

**Writing one.** `comment_work_item`, `report_work_item` and
`set_work_item_summary` take `list`, and so do the `comment` and `summary` groups
of `apply_work_item_changes` and each comment where a batch writes several:

```json
{"id": "MAIN-12", "body": "Found five places where the check misfires.",
 "list": {"label": "What to take on",
          "options": [{"id": "a", "label": "Widen the check", "recommended": true},
                      {"id": "b", "label": "Fix the docs", "description": "The two pages that name it."}]}}
```

`label` is text of 1 to 200 characters and `options` 1 to 20 options, written as a
question's options are. The list becomes a question of kind `question` whose prompt
is the label and whose one field is
`{"id": "items", "label": <label>, "type": "multi_choice", "required": false, "options": <options>}`,
so its answer is `{"items": ["a"]}`. The comment and its list are one write in one
transaction, under the call that writes the comment: both are written or neither.
The answer adds `list_request_id`, and a batch's `applied.comment` or
`applied.summary` carries it beside the comment's id:

```json
{"work_item": "MAIN-12", "comment_count": 11, "comment_id": 62,
 "reply_to": null, "reply_to_request": null,
 "list_request_id": "3f0c9a1e-6b2d-4e7f-9a8b-1c2d3e4f5a6b"}
```

Refused with `invalid_request`, nothing written:

| Case | Refusal |
| --- | --- |
| a list on a reply | `a list stands on a root, and this is a reply` |
| a key a list does not take, or options outside 1 to 20 | `list requires label and options and takes nothing else` |
| a list on an item that is closed | `a list on a closed item could never be answered; reopen it first, or leave the list out` |
| a list in a call that closes the item | `transition: a list on an item this call closes could never be answered; send it to review, or leave the list out`, on the `transition` step |

**What it does not do.** A list holds nothing: its item closes with a list
unticked, as with no question at all. It raises no Windows notification and takes
none back. It is not in [the panel of open questions](#the-panel-of-open-questions)
or its count, not on the "waiting for an answer" mark of a card or a row, and the
interface's read of every open question, `GET /api/modules/planning/requests`
without a target, leaves it out. It is read where its item is read:
`get_work_item`'s `questions`, `list_work_item_requests`, `get_work_item_request`,
the card's read of its item's questions, and an export. There it counts as a
question, open while it is pending, and its `comment_id` tells it apart. The
interface draws it in its comment, under the text, with no author of its own,
since the comment has one, and no "Do not answer", since nobody waits for it.

**Ticking.** Ticks are sent with one button, and ticking alone sends nothing, so
five ticks are one answer and one notice. A send with nothing ticked is allowed and
answers `{"items": []}`: the person has not decided the list, which is neither a
refusal of every option nor an answer with something missing. The compact form of a
list says so in `undecided`, `["items"]` while nothing on it is ticked and `[]`
once something is, in `previous` too, and the notice of that answer reads
`<label>: not decided`. A person's answer is a
`question_answered` event: the agent that wrote the list and the item's holders
hear it, as for any question (see
[the hook contract](hook-contract.md#who-is-told)), and the next agent write
carries it in `from_person`. Changing it is changing an answer.

**Close and reopen.** A pending list on a closed item reads `expired` with
`expired_reason: task_closed`, as any pending question there does, and nothing is
written: reopening the item makes it `pending` again with what it held. An answered
list on a closed item cannot be changed (`[task_closed]`). So a list freezes with
its item: the interface keeps ticks not yet sent in view and says that the item is
closed, the ticks would reach nobody, and reopening it lets them be sent. An agent
that wants the ticks keeps the item open, in review for instance.

**Merging.** A list goes with its comment: a comment root's list moves to the
survivor with it, and a report's list stays with the report on the merged item. A
comment is deleted only with its item, and its list with it.

### Steps from a comment

A comment or a report that holds a Markdown list can become steps of its item in
one action of the interface. This is the interface's alone and uses the existing
write: no tool, store change or notice is added.

- **Where.** An action on the head of a root, a reply or a report, shown only when
  its text holds at least one list item, the card can be written and the item is
  open.
- **What it offers.** Every item of every list in the text, in order, a nested one
  as a step of its own. A step's text is the item's Markdown as written, because
  steps are drawn as Markdown. All are ticked, except an item whose text matches a
  step the item has, or an earlier item, after trimming and collapsing spaces, case
  kept: that one reads as already there and cannot be ticked. An item longer than
  1000 characters cannot be ticked, and the form says why. The form counts the
  steps there will be, out of 100, and past 100 it cannot send and says how many to
  untick.
- **The write.** `POST /api/planning/work-item/checklist` with the item's steps by
  their `id`, then the new ones by text, and the `expected_revision` the card read.
  A stale revision is `revision_conflict`, and the form offers to read the item
  again with its ticks kept. The server checks its limits as it always does.
- **What follows.** The steps are ordinary steps, with their ids, claims and ticks,
  and nothing ties a step to the comment it came from. A holder hears
  `steps_edited`, as for any change of steps a person makes; with no holder, whoever
  claims the item next finds them.

### What a click opens

`GET /api/open-plan` says what a click on a session, a file or a folder should do.
The desktop app and the browser carry out the same plan, and neither decides where
a session goes:

```text
GET /api/open-plan?target=session&session=<id>&surface=desktop|browser
                  [&fallback=<place>][&always=<place>][&liveness=live|ended]
GET /api/open-plan?target=file&project=<id>&path=<relative>[&line=<n>]&surface=desktop|browser
                  [&fallback=<editor>]
GET /api/open-plan?target=folder&project=<id>&path=<relative>&surface=desktop|browser
                  [&fallback=<editor>]
```

The answer names local paths, so the route takes the same fetch metadata as the
session bootstrap: an `Origin`, when there is one, must be allowed
(`origin_refused`) and `Sec-Fetch-Site` must be `same-origin`
(`fetch_metadata_refused`), both 403. The desktop app's main process sends that
header itself, as any local process may. Every plan carries
`Cache-Control: no-store`. A request outside the closed values is `invalid_request`
(400), and it names the parameter.

`fallback` and `always` take `vscode`, `vscode-insiders`, `cursor`, `windsurf`,
`terminal`, `claude-desktop` or `codex-app`; a place of another client is ignored.
`liveness` is the caller's own check of the process, which replaces
`sessions.status`.

A session opens where it was last open. The planner tries the place recorded in
its row, or for a row older than that record the place its transcript names, then
`fallback`, then VS Code. `always` replaces that chain with the one place it names,
and when that place cannot be opened the plan says so instead of going elsewhere. A
subagent opens through its parent. A file or a folder opens in the editor `fallback`
names, VS Code by default, and only inside the project named: the path goes through
the same check as `GET /api/documents/read`, and the plan is the one place the
absolute path it found is told to the page. A path in a document Valkama shows is
named the same way: the page asks `GET /api/documents/resolve` with that
document's `project` as the base, and takes `project` and `relative` from the
answer.

```json
{"target": {"kind": "session", "session": "<id>", "agent": ""},
 "surface": "browser", "client": "claude", "state": "ended",
 "place": {"opened_in": "ide", "opened_host": "vscode", "source": "recorded", "first_open": false},
 "opens": {"opened_in": "ide", "opened_host": "vscode", "source": "recorded", "missed": ""},
 "one_action": false,
 "steps": [{"kind": "focus-folder", "ide": "vscode", "folder": "...", "link": "vscode://file/..."},
           {"kind": "open-link", "scheme": "vscode", "link": "vscode://anthropic.claude-code/open?session=<id>"}]}
```

- `place` is where the session is open, and `source` is `recorded`, `derived` or
  `none`. `first_open` means the place came from a Codex rollout, which names the
  thread's creator and not its last place.
- `opens` is where the click goes, or `null` when the plan only explains. Its
  `source` adds `fallback` and `always`, and `missed` names a place that was passed
  over because it is not installed.
- `state` is `live`, `ended`, `gone`, `headless` or `none`.
- `one_action` says one click may run every step. Otherwise each step takes its own
  action from the person. In the app a window and the link in it are one action: it
  waits for the editor to start the window, pauses and sends the link. In a browser
  they are two, because a browser may refuse a second outside program on one press.

| Step | Fields | Who carries it out |
| --- | --- | --- |
| `focus-folder` | `ide`, `folder`; `link` for the browser | the app starts the editor on the folder, the browser follows the link |
| `open-link` | `scheme`, `link` | both |
| `resume-in-terminal` | `client`, `session`, `folder` | the app |
| `desktop-resume` | `session` | the app |
| `open-file` | `ide`, `path`, `line`; `link` for the browser | the app starts the editor on the file, the browser follows the link |
| `copy` | `text` | both |
| `explain` | `reason`; `host`, `archived` or `code` where they apply | both |

`scheme` is one of `vscode`, `vscode-insiders`, `cursor`, `windsurf`, `claude`,
`codex` or `claude-cli`. A `folder` or a `path` is on a drive (`C:\…`), with no
`..` segment, no control character and at most 1024 characters; the folder of a
`resume-in-terminal` also holds no `;`, which Windows Terminal reads as the start of
another command. The app refuses a whole plan with one step it does not take, so
the server offers no other: a session whose folder breaks the rule explains
`no-folder` or, for a terminal, goes on to the next way to resume it, and a file
in a project on a network share is `path-refused` with `invalid_path`.
`tests/fixtures/folder-samples.json` holds the cases both sides are tested
against. `reason` is one of:

| `reason` | Meaning |
| --- | --- |
| `no-session`, `invalid-session` | No such session, or an id that cannot go into a link or a command line |
| `unsupported-client` | A client other than Claude Code or Codex |
| `gone` | The session ended and its client deleted the transcript. `archived` says whether Valkama keeps a copy. No link is offered, because one would start an empty conversation |
| `live-headless` | It runs without a window. Stopping it is the attempt's business |
| `live-in-terminal` | It runs in a terminal Valkama cannot raise, and a second process would write to the same transcript. Steps after this one look at it elsewhere. `silent_since` is present when the row's last signal is more than a day old and the caller's `liveness` did not say `live`: the client may have crashed with no end signal. The plan's last step then resumes it (`resume-in-terminal`, or in a browser `copy` of the command), which is an offer for the person to press on its own, with a warning about two processes on one transcript; it is not one of the steps that look at it |
| `live-elsewhere` | It runs somewhere else, and no route here is safe for a live session |
| `no-folder` | No folder is known for the session, and a link without a window opens an empty conversation |
| `not-installed` | `host` is not installed: its scheme has no live handler, or its editor lacks the extension |
| `path-refused` | A file or folder target that opens nothing. `code` is `project_unknown`, `invalid_path`, `outside_root`, `not_found`, `not_a_file`, `unreadable`, `directory` (a file target that is a folder) or `not_a_folder` (a folder target that is not one) |

`GET /api/open-places` answers `{"places": {"vscode": true, "cursor": false, ...}}`
for each value `fallback` and `always` take, under the same fetch metadata, so the
settings offer what the machine can open. A terminal is always `true`, because
without Windows Terminal a plan copies the command instead.

Which schemes are installed comes from the Windows classes the shell itself
resolves a scheme through. A key that carries `URL Protocol` counts, unless its
`shell\open\command` names a program that no longer exists.

Four routes and behaviours are undocumented or could not be settled by reading,
and each stays off in `url_schemes.SEEN_LIVE` until it has been watched working:
`claude://code/continue`, `/resume` through `claude-cli://`, the extension's "still
open somewhere else" notice holding its input, and
`vscode://openai.chatgpt/local/<id>`. Until then the plan takes the documented way
round: `desktop-resume`, a command to copy, only the explanation, and the Codex app.
A link landing in the window just opened is not on this list. Its window cannot be
waited for any better than a pause, a miss costs one more press, and so the app
takes it as a matter of course. Every client detail a plan depends on is listed in
[What a client update can change](hook-contract.md#what-a-client-update-can-change).

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
