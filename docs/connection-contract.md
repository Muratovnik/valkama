---
status: adopted
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
| read-only | `true` | — | `true` | the reading tools: `list_planning_spaces`, `get_planning_space`, `get_work_item`, `get_work_item_chain`, `read_work_item_image`, `list_work_items`, `search_work_items`, `list_platform_modules` |
| writing | `false` | `false` | — | everything else |
| destructive | `false` | `true` | — | `delete_work_item` |

`openWorldHint` is `false` throughout, because nothing here leaves the machine.

### Removed tools

The catalogue holds one tool per capability. A write to one item's fields,
steps, refs, commits, links, discussion, summary or state is a group of
`apply_work_item_changes` (see
[Several changes in one call](#several-changes-in-one-call)); the tools that
made one such write each are no longer published, and the HTTP writes behind
them are unchanged. A session that started before the change still holds their
schemas, so a call to one of those names is refused, writing nothing, with
status 404, the code `removed_tool` and a message that names the call doing its
work, with an example:

```json
{"error": {"code": "removed_tool",
 "message": "<name> is no longer a Valkama tool; call apply_work_item_changes with transition: {\"id\": \"MAIN-12\", \"transition\": {\"state\": \"done\"}}. This session's tool list predates the change: restart the client session to load the current one."}}
```

It is a refusal, not an alias: the call does nothing, so an agent repeats it in
the named form. The names and their replacements are listed in the changelog.
Restarting the client session loads the current list.

### Tool results

A tool result is one line of JSON text, without indentation. The one
exception is `read_work_item_image` (see
[Pictures on an item](#pictures-on-an-item)), whose result is an MCP `image`
content block followed by a text block of JSON.

A write to a work item answers with a short acknowledgement instead of the whole
item: `reference`, `url`, `work_item_id`, `revision`, `state` (`key`, `name`,
`is_terminal`; `null` for an accepted open goal or stage, whose `container_state`
alone says what it derives), `open` (whether its work is over), `claim_ref` and
`claim_state`, plus `container_state` where the item has one and what that call
changed. `url` is described in [The address of a work item](#the-address-of-a-work-item).
`revision` is the value to pass as `expected_revision` on the next write.
`claim_state` is the holder's lease, described in
[Claims are leases](#claims-are-leases).

| Tool | Also carries |
| --- | --- |
| `create_work_item` | `title`, `kind`, `priority`; `similar`, up to three open items of the space that read like the new one, each `{reference, title}`, best first and possibly empty; `applied` when it took `claim` or `links`; `started` and `warnings` from its claim when there are any; `project_roots` when it took `claim` |
| `claim_work_item` | `claim_ref` is the holder and `claim_state` its lease; `started`, `requeued`, `warnings` and `overridden` when there are any (see [A claim starts the work](#a-claim-starts-the-work)); `project_roots` unless it released |
| `claim_work_item_checklist_item` | `step`: `item_id`, `done`, `claimed_by`, `done_by`, `by_previous_holder`; `overridden` when `force` carried another holder's claim through |
| `apply_work_item_changes` | `applied`, what each group changed, with `released` in `applied.transition` when a close released a claim (see [A close ends the claims](#a-close-ends-the-claims)); `started` from its claim, `overridden` from its steps and its transition, and the `warnings` of both, when there are any; `mentions` when its `update` named other items; `project_roots` when it took `claim`; `unreported_commits`, `unreported_total` and `unreported_unread` when a close found any (see [The net at a close](#the-net-at-a-close)) |
| `merge_work_items` | `merged`, what each item moved (see [Merging items that are one change](#merging-items-that-are-one-change)); `warnings` and `overridden` when there are any |

`project_roots` is the root of each project the claimed task changes, or of its
space's default project when it names none: a list of `{project_id, display_name,
root, status}`, `status` one of `mapped`, `missing` (no directory at the root),
`unregistered` (the registry no longer records the project) and `unavailable` (the
registry was not read; `root` and `display_name` are then null, and a task that
names no project has an empty list). The projects of the task's space come first,
its default project before the others, then every other project, each part by
`project_id`; with an unread registry all come by `project_id`. The claim does not
check them. `claim_ready_work_item` carries it beside the `work_item` it took.

A comment the batch wrote is named in `applied` by its `comment_id`, and the
`reply_to` and `reply_to_request` of the root a reply landed under; a resolved
mark by its `comment_id` and `resolution`. Both are described in
[Threads and the resolved mark](#threads-and-the-resolved-mark). A comment or a
summary also carries `list_request_id` when the call wrote a
[list](#a-list-on-a-comment), and `mentions` when the call named other items (see
[Mentions](#mentions)).

Every tool that writes to a work item and leaves it standing -- all of the above,
`claim_ready_work_item` and the question tools -- also carries `from_person` when
a person acted on that item
through the interface since an agent last wrote to it, and only then; see
[What a person did reaches the agent](#what-a-person-did-reaches-the-agent).
A claim's answer carries `waiting` beside it when a person's words on a goal or
stage over the work found nobody working there; see
[Words that wait for a session](#words-that-wait-for-a-session).
A `verbose` answer carries both too. `delete_work_item` and `create_planning_space`
never do.

Each of these tools takes an optional boolean `verbose`, false by default. With
`verbose: true` the answer is the item's card, as `get_work_item` returns it
without `parts` (see [The card](#the-card)), with what the write reports beside
it. `claim_ready_work_item` always answers with the item it took, since the agent
needs it, and its `work_item` is the card too. The reads,
`create_planning_space`, `delete_work_item` and the question tools are
unchanged, and so is every refusal. The HTTP API is unchanged: it always
answers with the full item.

`list_work_items` and `search_work_items` answer one compact row per item:
`reference`, `title`, `kind`, `state` (the key), `priority`, `parent` (a
reference, or `null`), `claim_ref` and `claim_state`, plus `comment_hit` and
`summary_hit` on a search that matched there. The row of an accepted open goal or
stage has `state` `null` and adds its `container_state` (see
[The work model](#the-work-model)). Without a `limit` they return at most 50 rows.
A search reads its query as words: an item matches when its title, description,
labels, source, the ids of its projects (see
[The projects an item changes](#the-projects-an-item-changes)), summary,
comments, decisions or questions hold every word, in any order and across
fields, each word matched by its first five letters as a prefix. A project id
is split into words as any text is, so `relay` and `service` each find an item
that names `event-relay-service`; a project's display name is not searched, and
a goal or stage, which names no projects, is not found by those of its tasks.
Words such as `the` or `and` are left out of a query that has others.
The best match comes first, the title weighing three times the rest, and a tie
goes to the most recently changed item. `comment_hit`, `question_hit` and
`summary_hit` then name the newest comment, decision or question holding every
word, and whether the summary does. A search whose query is exactly a work-item
reference -- `MAIN-12`, in any case, with surrounding spaces ignored -- is read
as one phrase, as every query was before words: it answers that item first, and
every other match keeps its order, most recently changed first. A query that is
a number alone -- `12` -- does the same for the item numbered 12: in a search
scoped to a space that is one item, and without a space it is each space's item
12. A store whose word index cannot be read -- a SQLite without FTS5, or an
attached store an earlier build wrote -- reads every query as one phrase, and a
phrase finds an item when it stands in the id of one of its projects as well.
`list_work_items` also takes `parent`, a work item by reference or id, and then
lists only that item's children; the HTTP read `GET /api/planning/work-items`
takes the same `parent` parameter. An unknown `parent` is refused with
`not_found`. With `space`, `list_work_items` and `GET /api/planning/work-items`
read that space: its items, and the items of other spaces that name one of the
projects the registry binds to it. Each item of such a read carries
`other_space`, the `{key, name}` of the space it lies in, or `null` for the
space's own; a compact row carries it only for another space's item. The
space's queue never gives another space's item: its `withheld` adds
`outside_space` and its `queue_order` is `null`, though the queue of its own
space may give it. They take
`project` too, a project id: the list keeps the items that name that project,
in every space unless `space` is given. With `space`, it keeps that space's
items that name it, and other spaces' items that name it when it is one of the
space's projects. A goal or stage stores no projects and names those of every
task under it, at any depth, so it is kept when one of them names the project;
a project no item names lists nothing.

Each answer is one page. `truncated` is true when more items match than the page
holds, and `next_offset` is then the offset of the next page; on the last page
it is `null`. A page holds at most 1000 items for `list_work_items` and 200 for
`search_work_items`. A larger `limit` is answered with at most one page, and
`truncated` still says whether more items match. Both tools take an optional
`offset`, a non-negative integer, 0 by default. Calling again with the same
filters and each `next_offset` until it is `null` returns every matching item
exactly once, as long as nothing writes to the store in between: a list orders
every item its filters keep before it cuts the page. A write between two pages
that changes an item's place -- a transition, a priority, a start, a goal or
stage coming under way -- can move it across the boundary; time passing, a lease
lapsing or a question's deadline passing moves no row, only its `queue_order`. An `offset` that is negative or
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

With `verbose: true` they answer with each item's list record, the brief record
the HTTP list carries, at the limits they had before (200 for a list, 50 for a
search), and with the same `truncated` and `next_offset`. The HTTP reads `GET /api/planning/work-items` and
`GET /api/planning/search` take the same `offset` parameter and carry the same
two fields.

### The items one session holds

`GET /api/planning/held?session=<session id>` answers which open work items one
agent session holds, so that a client can show a person, beside that session, the
work it is on. It writes nothing and has no MCP tool. The answer names the session
as given and lists its items, most recently changed first:

```json
{"session": "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e",
 "items": [{"reference": "MAIN-12", "title": "Fix the parser",
            "state": {"key": "dev", "name": "Dev", "category": "active"},
            "held_as": "claim", "steps": {"done": 1, "total": 3},
            "pending_questions": 0, "url": "http://127.0.0.1:8642/open/MAIN-12"}]}
```

An item is held when its claim, or a checklist step that is not done, carries a
holder label of the session (see [Who holds a claim or a step](#who-holds-a-claim-or-a-step)):
the label ends in `(session <id>)`, so what a subagent of the session holds counts
as well. `held_as` is `claim` when the item's claim is the session's, else `step`.
Only an item in a state that is not terminal is listed, and only a hold that has not
lapsed: a claim whose lease reads `stale` (see [Claims are leases](#claims-are-leases))
holds nothing here, and neither does a step of a session whose claims would read
`stale`, although nothing has released either yet.

`steps` counts the item's checklist steps and those done. `pending_questions`
counts the questions and decisions on the item that still wait for a person: one
past its deadline or on a finished execution has lapsed, and a
[list on a comment](#a-list-on-a-comment) waits for nobody, so neither is counted.
`url` is the item's
[address](#the-address-of-a-work-item).

A session nothing names answers with no items. A missing or blank `session` is
refused with `invalid_request` and status 400.

### The work model

Since 3.0 every work item is one of five kinds, and its state is one of eight
categories or, for an accepted open goal or stage, what it derives from the work
under it. Why this broke the earlier schemas, and what a client sends and reads
instead, is in
[ADR 0014](decisions/0014-work-model-breaks-the-planning-schemas.md).

| `kind` | What it is |
| --- | --- |
| `task`, `bug`, `improvement` | work an agent takes, holds and finishes |
| `goal` | work that holds other work and stands under no parent |
| `stage` | work that holds other work and stands under a goal or another stage, at any depth |

A goal or a stage is never claimed or worked itself: what stands under it is. A
`kind` sent as `goal` with a parent is read as `stage`; `stage` without one is
refused. An edit changes a kind only among `task`, `bug` and `improvement`; a
task and a goal or stage become each other by
[converting](#converting-a-task-into-a-goal-or-stage).
`list_work_items` with `kind=goal` lists the goals, with `kind=stage` the stages.

| Category | The work in it |
| --- | --- |
| `triage` | not yet decided on: nobody has accepted it |
| `deferred` | put off |
| `ready` | accepted and waiting for someone to take it |
| `active` | being worked: it always has a holder |
| `review` | done and waiting for the owner's answer |
| `completed` | done |
| `blocked` | stopped by hand, with a stated reason, for a cause outside Valkama; work that waits on another item is linked `blocks` and stays where it is |
| `cancelled` | not to be done |

The whole record of an item -- the answer of `GET /api/planning/work-item`, an
item of `GET /api/planning/work-items`, and the HTTP answer of a write to an
item -- and the card `get_work_item` answers with carry these fields of the
model; the card's `state` has no `is_terminal`:

| Field | What it holds |
| --- | --- |
| `state` | `key`, `name`, `category` and `is_terminal` of its workflow state; `null` exactly for an accepted open goal or stage |
| `open` | whether its work is still open: false in a `completed` or `cancelled` state. A reader decides openness by it, since an accepted open goal or stage has no `state` to read `is_terminal` from |
| `container_state` | for an accepted open goal or stage, `not_started`, `in_progress` or `awaiting_confirmation`; `null` for every other item, a goal or stage in `triage`, `deferred`, `completed` or `cancelled` included, whose `state` says where it stands |
| `acceptance` | `{basis, at}`: why and when the work was accepted, the basis being `owner`, `assignment`, `inherited`, `label_rule` or `migrated`; `null` while it is not, in `triage`, `deferred`, or cancelled before it was |
| `started_at` | when work on it began: its first claim or its first entry into `active`, `review` or `completed`. A goal's or stage's is the earliest of the work under it |
| `waits_for` | the open items that block it |
| `cancelled_blockers` | the cancelled items still linked `blocks` to it, by reference, which `waits_for` no longer names: the work it waited for will not be done. Only on open work and only when there is one; it lasts while the link stands |
| `workable` | whether its space's take-next queue may give it now: `withheld` is empty. It is the rule `claim_ready_work_item` takes work by |
| `withheld` | why the queue does not give it, as codes in this order: `goal_or_stage` (a goal or stage, which has no other code), `not_ready` (not in a `ready` state), `held` (a claim, or a claimed step), `waits` (an unfinished blocker), `question` (an open question to the owner), `no_start` (in a `ready` state its workflow leads nowhere into work from), `ancestor_triage` and `ancestor_deferred` (a goal or stage over it stands there), `ancestor_waits` (a goal or stage over it has an unfinished blocker), `ancestor_closed` (a goal or stage over it is closed while it is open), `outside_space` (a read of another space holds it, for a project of that space it names: that space's queue never gives it). Empty exactly when `workable` |
| `projects` | the projects it changes, by `project_id`: each with the registry's `display_name` (`null` while the registry does not record it) and its `source`, `named`, `commits` or `migrated` (see [The projects an item changes](#the-projects-an-item-changes)). A goal's or stage's are those of every task under it |

Four other answers carry only some of these fields:

- an MCP list row (`list_work_items`, unless `verbose`) carries `state`, as its
  key (`null` for an accepted open goal or stage), `container_state` where the
  item has one, `queue_order` where the queue gives it and `withheld` where it
  does not; none of `open`, `acceptance`, `started_at`, `waits_for` or `workable`;
- an HTTP chain member of `GET /api/planning/work-item/chain` carries `state`,
  `open`, `container_state` and `workable`; none of `acceptance`, `started_at` or
  `waits_for`;
- an MCP `get_work_item_chain` answers no members: its `open_members` are rows of
  `reference`, `title`, `state` (its key), `container_state` where the item has
  one, `claim_ref`, `claim_state`, `workable`, `parent_reference` and
  `queue_order`; none of `open`, `acceptance`, `started_at` or `waits_for`;
- an MCP write acknowledgement carries `state` (`null` for an accepted open goal
  or stage), `open` and `container_state` where the item has one; none of
  `acceptance`, `started_at`, `waits_for` or `workable`.

A goal or stage derives its `container_state` from the items under it. It is
`awaiting_confirmation` when it has had children and none of them is open,
`in_progress` when one is open and work has started on something under it at any
depth, and `not_started` otherwise, a goal with no children included. A child
moved out still counts as one it had.

`basis` `assignment` is the one an agent names, as `acceptance: "assignment"` on
`create_work_item` and in the `transition` group of `apply_work_item_changes`,
and on their HTTP writes. Any other value is refused. A write that accepts work
gives the basis in one order, whoever makes it:

1. work under goals and stages that are all accepted and open is `inherited`,
   whatever the call says;
2. otherwise a write the owner makes in the browser gives `owner`, and an agent's
   gives the `acceptance` it sends; a claim gives `assignment` without one;
3. otherwise the write is refused with the `acceptance` guard, which `force` does
   not carry.

A basis is given only to an item that has none: one in `triage` or `deferred`,
or cancelled before it was accepted, when it moves to `ready`, `active`,
`review`, `blocked` or `completed`, is created in `ready` or `active`, or is
claimed. Accepted work
keeps its basis through a close and a reopening; a move to `triage` takes it away.
An agent's `create_work_item` with no `state` and no basis to give therefore
files the item in `triage` rather than refusing it. `migrated` is the basis the
3.0 migration gives work accepted before it, and no write takes it.

A goal or stage is accepted by a transition to `ready`; it then stands in no
state a reader sees, and shows `state` `null` and its `container_state`. Accepted
out of `triage` or `deferred`, it accepts in the same write the work in `triage`
under it: each task moves to the first `ready` state it can reach and each goal or
stage stands accepted and is descended into; one with nowhere to go stays in
`triage`, named in `warnings`. Each takes its basis in the same order: `inherited`
when, with the goal or stage accepted, every goal and stage above it is accepted
and open, and otherwise the basis the accepting write gave, `owner` from the
browser and the `acceptance` an agent sent. A stage accepted under a goal that is
not accepted thus gives its work the stage's own basis, as a claim of that work
would, and leaves the goal as it is. A goal or stage in `deferred` stops the
descent, and nothing under it changes.

A record carries no `container` and no `ready` field: `kind` says which items
hold others, and `workable` which may be taken.

#### Retired words

The words of the model 3.0 replaced are refused wherever an input took them,
with `invalid_request` and before anything is written. The refusal names what
replaces the word; none is read as its replacement.

| Input | Word | The refusal says |
| --- | --- | --- |
| `kind` of a creation, an edit and a list | `epic` | `kind epic is retired: a container is kind goal, or stage under a parent` |
| `scope` of a chain and of an item's usage | `epic` | `scope epic is retired: scope tree reads the item and everything under it` |
| `category` of a list, and `state` wherever it is named | `backlog`, `queued` | `backlog is now triage` or `queued is now ready`, then what the input takes: the categories, or the workflow's states as an unknown name lists them |
| `state` wherever it is named | `todo` | what an unknown state name gets, listing the workflow's states |
| `category` of a list, and `state` wherever it is named | `container` | `container is not a category: an accepted goal or stage shows container_state; accept one with ready` |
| the `update` and `transition` groups, their HTTP writes, and a tool's arguments | the field `rank` | `rank is retired: the order of work is computed — urgent, started, a goal or stage under way, priority, age` |

### The projects an item changes

A task names the projects it changes, at most 20 and each once, by their ids in
the [project registry](guides/configuration.md#project-registry); the space it lies in does
not change with them. `create_work_item` takes them as `projects`, and the
`update` group of `apply_work_item_changes` (and `POST
/api/planning/work-item/update`) replaces the whole set with `projects`, each
project it names then `named`. That edit is guarded by `expected_revision` and
bumps the revision once, records no history event, and writes nothing when the
set and its sources are what the item has. Each project has one `source`: `named`
by whoever filed or edited the item, `commits` derived from the repositories of
its commits, or `migrated`, its space's former project when the migration found
nothing else. A project that comes by two ways keeps the strongest, in that
order.

A goal or stage names no projects. Its `projects` are those of every task under
it at any depth, each project once with the strongest source any of them gives
it. Refused with `invalid_request` and the code `[project]`, before anything is
written:

- a project the registry does not record: `project X is not registered:
  registered projects are …`;
- any project while the registry cannot be read: `the project registry cannot be
  read, so projects cannot be named now`. A write that names no projects passes;
- projects on a goal or stage: `a goal or stage names no projects: the tasks
  under it do`.

### Where a new item lies

`space` is optional on `create_work_item` and on `POST /api/planning/work-items`.
The server places the new item:

1. under a `parent`, in the parent's space;
2. else, with `projects`, in their home space, the space of this store the
   registry binds each to: one home is where the item lies; between several,
   `space` must name one of them; projects without a home need `space`;
3. else in the space it names, and without one in the space of the calling
   session, the space whose project root holds the session's folder. The same
   space is `session_space` in the answer of `list_planning_spaces`, `null`
   when the call proved no session or its folder lies in no space; the HTTP
   list has no session and no such field.

A later edit of `projects` does not move the item: its number stays. Refused
with `invalid_request` and the code `[placement]`, naming the candidates where
there are any, before anything is written:

- projects of two spaces without `space`: `projects A and B live in ALPHA and
  ROVER: name one of them as space`;
- a `space` that is not one of the projects' homes: `space TEST is none of the
  spaces of the item's projects: ALPHA, ROVER`;
- a `space` that is not the parent's: `the parent lies in ALPHA: an item lies in
  its parent's space`;
- projects without a home and no `space`: `project X lives in no space of this
  store: name the space`;
- no parent, projects, space or session space: `name the space, or the projects
  the item changes`.

### Naming a state

A workflow's states are rows, so their keys belong to the space: the default
workflow keys its active state `dev`, and another workflow may call it something
else. What every workflow shares is the category. Wherever a write names a
state -- the `state` of the `transition` group of `apply_work_item_changes`,
of `create_work_item`, and of their HTTP writes -- it
is read, in this order, as:

1. a `state_id` or a key of the item's workflow;
2. a category (`triage`, `deferred`, `ready`, `active`, `review`, `completed`,
   `blocked`, `cancelled`) that exactly one state of the workflow has.

A key wins over a category, so `review` is the state keyed `review` even in a
workflow that gives the review category to two states. A category that two or
more states share is refused with `invalid_request`, naming their keys:
`category active names 2 states in this workflow: dev, pairing; name one by its
key`. A name that is neither is refused with `invalid_request` listing every
state as `key (category)` and the categories that name a state alone:

```text
this workflow has no state named in_progress; its states are triage (triage),
deferred (deferred), ready (ready), dev (active), review (review), done (completed),
blocked (blocked), cancelled (cancelled); a category names a state when exactly one
state has it: triage, deferred, ready, active, review, completed, blocked, cancelled
```

Both refusals come before any guard and write nothing. Reads keep their two
filters apart: `list_work_items` takes `state` as a key and `category` as a
category. A `state` key that no workflow of the spaces read has is refused the
same way, listing their states, rather than answered with an empty list; a
retired name is refused as [Retired words](#retired-words) says.

### The order of work

The order work is taken in is computed, never set. The key of work puts first
the item that is `urgent`; then one already started (`started_at` set), which
includes work the lease sweep handed back; then one whose goal or stage, its
parent, is `in_progress`; then by priority, `high`, `medium`, `low`; then the
older by `created_at`. `claim_ready_work_item` gives the `workable` tasks in
that order, the smaller number first on a tie.

`claim_ready_work_item` and `POST /api/planning/work-item/claim-ready` read the
queue of one space: `space`, else the space of `within`, else the space of the
calling session, the space whose project root holds the session's folder, which
is `session_space` in the answer of `list_planning_spaces`. A call that proved no
session has none, nor does a session whose folder lies under no root of a
project bound to a space, nor any call while the registry cannot be read; the
HTTP write has no session. `within` names a goal or stage, by reference or id,
and keeps the tasks under it at any depth; without `space` it may name one of
any space, and its space is the call's. `label` keeps the tasks that carry that
label themselves, not through a goal or stage over them. `project`, a project
id, keeps the tasks that name that project, as the `project` of a list keeps
them: a task that names no project is kept by none, not even by its space's
default project, and a project of another space keeps the tasks of the call's
space that name it. A label nothing carries and a project nothing names keep
nothing. Each narrows the one queue without reordering it, and together a task
must meet each. Each refusal is `invalid_request` and comes before anything is
written, the release of lapsed leases included:

| Input | Refusal |
| --- | --- |
| `within` names a task | `within names a goal or stage; MAIN-12 is a task` |
| `within` of another space than `space` | `within MAIN-3 is in space MAIN, not OPS` |
| neither `space` nor `within`, and no space of the session | `name a space: no space's project root holds this session's folder; the spaces are MAIN, OPS` |

A task of any space is claimed by number with `claim_work_item`, whatever the
queue a session reads.

Every read of many items stands on one total order: the state's place in its
workflow, the key of work, the space's key, the number. `list_work_items` and its
pages, `GET /api/planning/work-items`, the board's `GET /api/planning`, the
graph built from it, the exact read of a space and the members of a chain all
take it, given and not given rows alike; a goal or stage takes the parts of the
key from its own priority, the earliest start under it and its parent. Without a
space the rows of different spaces interleave, a tie going to the smaller space
key. The key reads stored fields and the tree of items, never the clock or a
lease.

A row of a list read -- `list_work_items`, its pages, `work_items` of
`GET /api/planning` -- and a chain member carry `queue_order`: the row's 1-based
place in the queue of its own space, 1 for the task `claim_ready_work_item` gives
next unless a lease lapses before the call (the queue releases lapsed leases
first, a read does not), and `null` for every item the queue does not give, whose
`withheld` says why. It is the place at the time of the read, so a row keeps its
place in the list when time passes and only its `queue_order` changes. A single
item's record, its preview, a search and a write's answer carry no
`queue_order`: a place belongs to the list, and any write in the space can change
it.

Nothing places an item by hand. `rank` is retired: the `update` and `transition`
groups of `apply_work_item_changes`, `POST /api/planning/work-item/update`,
`/transition` and the steps of `/apply` refuse it with `invalid_request` before
anything is written, and so does a tool call that carries it as an argument.
The refusal says what [Retired words](#retired-words) lists, after the name of
the group or step it was sent in. An item moved to another state takes the place
the order of work gives it there.

`labels` in the same edit replaces the item's whole set of labels. `labels_add`
and `labels_remove` change the set the item has instead, read under the write
lock, so a caller adds or removes a label without knowing the others. A label
already there is kept once in its place, one the item lacks is ignored, and the
resulting set is held to the same 32 labels as a whole one. `labels` beside
either of them is refused with `invalid_request`, because a replacement and a
change of the set it replaces have no order that is the one the caller meant;
so is a label named in both. `applied.update` names the fields sent, and the
call row's `reason` names `labels` only when the set changed.

A change of the label set is the one edit the history records. Whichever of the
three fields made it, and through whichever write (the `update` group of
`apply_work_item_changes`, `POST /api/planning/work-item/update` or `/apply`),
the item gains one `labels_changed` event under the call that made
the edit, its author the edit's `author`. An edit that changes the set therefore
answers for its `author` as a comment or a claim does: one over 128 characters,
or holding a carriage return or a NUL, is refused before anything is written,
where an edit of another field still ignores it. Its `detail` is JSON with the
set the item had and the set it has, each in the item's own order:

```json
{"action": "labels_changed", "detail": "{\"from\":[\"bug\",\"triage\"],\"to\":[\"bug\",\"triage\",\"ux\"]}",
 "author": "codex", "at": "2026-11-11T12:00:00Z",
 "identity": {"state": "confirmed", "source": "codex-meta", "session_id": "019a…", "agent_id": null}}
```

An edit that leaves the set as it was writes no event: adding a label the item
has, removing one it lacks, or sending the same labels in another order. Every
other field's edit still writes none. A detail of this event can exceed the 512
characters a caller's detail is held to: a full set of 32 labels of 64
characters before and after is written whole, up to 24,785 characters. A
person's edit of the labels reaches an agent as the edit it is (`from_person`'s
`edited`, naming `labels`), never also as this event. The event exists from
store schema 15 on; see [A build that was already old when it
started](#a-build-that-was-already-old-when-it-started).

Work in `triage` or `deferred` is not accepted and is never given, whatever its
key.

### Reading one work item

**Since 3.0.** `get_work_item` reads an item by parts: by default its card, and
any other part by name. Why this broke the earlier read, which answered with the
whole record and took `full`, is in
[ADR 0014](decisions/0014-work-model-breaks-the-planning-schemas.md).

| Argument | Type | What it reads |
| --- | --- | --- |
| `id` | a work item | required: the item |
| `parts` | a part name, or a list of them | those parts, each once in the order named |
| `unresolved` | boolean | a page of the roots without the resolved mark |
| `thread` | integer, at least 1 | one thread |
| `comments_after` | integer, at least 0 | a flat page of comments after that id; beside `unresolved`, where the next page of roots starts |
| `events` | integer, 1 to 1000 | that many of the newest history events |
| `section` | a section key, or a list of them | those sections of the description, with their text |

The parts are `card`, `comments`, `events`, `links`, `refs`, `commits`,
`questions`, `mentions`, `sessions`, `images`, `subscribers`, `claim`, `sections`,
`participants` and `confirmation`. Without `parts` and without a mode the read is `["card"]`. A
mode without `parts` reads only the part it cuts: `unresolved`, `thread` and
`comments_after` the comments, `events` the events, `section` the sections, and
several modes read each of their parts. Each of these is refused with
`invalid_request`:

| Call | Refusal |
| --- | --- |
| a part no item has | `unknown part 'history'; parts are card, comments, events, links, refs, commits, questions, mentions, sessions, images, subscribers, claim, sections, participants, confirmation` |
| a mode beside a `parts` without its part | `thread reads the comments part: add comments to parts or leave parts out`, and the same for `unresolved` and `comments_after`; `events reads the events part: …`; `section reads the sections part: …` |
| `events` outside its bounds | `events must be between 1 and 1000` |
| `thread` with `comments_after` or `unresolved` | `thread and comments_after exclude each other`, or `thread and unresolved …` |
| `parts` that is neither a name nor a list of names | `parts must be a part name or a list of them` |
| `section` that is neither a key nor a list of keys | `section must be a section key or a list of them` |
| a key the description does not have | see [Sections of the description](#sections-of-the-description) |
| `full`, the argument 3.0 removed | `get_work_item: unknown argument 'full'; expected 'id' (required), 'parts', …` |

The answer carries `reference` and `revision`, the revision every part was read
at, and beside them the fields of each part named:

| Part | Fields |
| --- | --- |
| `card` | the card's fields below, with `parts` |
| `comments` | `comments`, `comments_total` (every row), `threads_total` (the roots), `unresolved_total` (the roots without the resolved mark) and `truncated` |
| `events` | `events`, the newest 10 or the newest `events`, oldest first; `events_total` and `events_truncated`, true when some are left out. The flag has its own name because both parts may come in one answer |
| `mentions` | `mentions`, the newest 50, oldest first, and `mentions_total`; see [Mentions](#mentions) |
| `sections` | `sections`, as [Sections of the description](#sections-of-the-description) says |
| `claim` | `claim`, the lease as [Claims are leases](#claims-are-leases) shows it, `null` while nobody holds the item |
| `commits` | `commits`, as [The commits part](#the-commits-part) says |
| `links`, `refs`, `questions`, `sessions`, `images`, `subscribers` | the field of that name, as described below and in [Reading a question](#reading-a-question) |
| `participants` | on a goal or a stage, the field of that name, as [Participants](#participants) shows it; a task has no such part, and naming it is refused with `unknown part 'participants'; a task's parts are card, comments, …` |
| `confirmation` | on a goal or stage awaiting confirmation, the field of that name, as [Completing a goal or stage](#completing-a-goal-or-stage) shows it; on any other item the answer has no such field |

#### The card

The card is how an agent meets an item: `get_work_item` without `parts`, a write
with `verbose: true` and the `work_item` of `claim_ready_work_item` answer with
it. It carries, in this order:

| Field | What it holds |
| --- | --- |
| `reference`, `title`, `kind`, `priority` | as [The work model](#the-work-model) names them |
| `state` | `key`, `name` and `category`; `null` for an accepted open goal or stage. `open` says whether the work is over |
| `open`, `container_state`, `acceptance`, `started_at`, `waits_for`, `workable`, `withheld` | as [The work model](#the-work-model) says |
| `projects` | the projects the item changes, each with its `project_id`, `display_name` and `source`, as [The projects an item changes](#the-projects-an-item-changes) says |
| `claim_ref`, `claim_state`, `last_claim_ref`, `lapsed_claim`, `closed_at` | who holds it and how the lease stands; who held it last; whose claim the sweep released, as [Claims are leases](#claims-are-leases) says; and when it closed, `null` while it is open |
| `labels`, `source`, `revision`, `created_at`, `updated_at` | as in the full record |
| `url` | the item's [address](#the-address-of-a-work-item) |
| `parent` | the parent's reference, or `null` |
| `description` | the whole text |
| `checklist` | each step as `id`, `text` and `done`, plus `claimed_by` and `done_by` only when they are set, and `by_previous_holder: true` only when a lapsed holder ticked it |
| `summary` | the closing summary, only when there is one |
| `parts` | every other part the item has, with its size |

The card leaves out what its reference and parts stand for: `work_item_id`,
`planning_space_id`, `number`, `parent_id`, `summary_comment_id`,
`comment_count`, the `state_id` and `is_terminal` of the state, the lease (the
`claim` part) and every list of the history. A write's answer keeps, beside the
card, what the write itself reports, such as `applied`, `started`, `requeued`,
`released`, `merged`, `similar`, `warnings`, `overridden`, `from_person` and the
`unreported_*` fields of a close.

`parts` names each other part with what it holds, and leaves out a part with
nothing in it:

| Part | Its entry |
| --- | --- |
| `comments` | `count`, `threads` (the roots), `unresolved` (the roots without the mark) and `chars`, the length of every body and report |
| `events` | `count` and `chars`, the length of every `detail` |
| `questions` | `count` and `open`, the questions to the owner, and `addressed_open`, the open requests asked of agent sessions; it stands while any of them is above 0 |
| `sections` | `count`, and only for a description longer than 2,000 characters; a shorter one is cheaper to read whole |
| `claim` | `count`, 1 while somebody holds the item |
| `commits` | `count`, the commits attached now |
| `links`, `refs`, `mentions`, `sessions`, `images`, `subscribers`, `participants` | `count` |

```json
{"reference": "MAIN-12", "revision": 14, "title": "Widen the check", "kind": "task",
 "priority": "medium", "state": {"key": "dev", "name": "Dev", "category": "active"},
 "open": true, "container_state": null,
 "acceptance": {"basis": "assignment", "at": "2026-11-06T10:00:00Z"},
 "started_at": "2026-11-06T10:00:00Z", "waits_for": [], "workable": false,
 "claim_ref": "claude (session 019a…)", "claim_state": "live", "last_claim_ref": null,
 "closed_at": null, "labels": ["hooks"], "source": "",
 "created_at": "2026-11-06T09:58:00Z", "updated_at": "2026-11-06T11:20:00Z",
 "url": "http://127.0.0.1:8642/open/MAIN-12", "parent": "MAIN-3", "description": "…",
 "checklist": [{"id": "…", "text": "Inventory", "done": true, "done_by": "claude (session 019a…)"},
               {"id": "…", "text": "Tests", "done": false}],
 "parts": {"comments": {"count": 9, "threads": 4, "unresolved": 4, "chars": 5210},
           "events": {"count": 22, "chars": 1830}, "refs": {"count": 3},
           "sessions": {"count": 2}, "claim": {"count": 1}}}
```

#### The comments part

Comments form threads (see
[Threads and the resolved mark](#threads-and-the-resolved-mark)), and the
comments part takes one of four modes:

| Mode | `comments` holds |
| --- | --- |
| none | the 5 threads with the latest activity -- a thread's activity is the greatest id in it -- oldest first; each root carries `replies` and `last_reply`. `truncated` says older threads are left out |
| `thread: <id>` | that thread: its root and every reply, oldest first. The id of a reply reads the thread of its root. The replies under a question are read with `get_work_item_request` |
| `unresolved: true` | the unresolved roots, oldest first, at most 20, each with `replies` and `last_reply`; `truncated` says more remain, and the next page is read with `comments_after` set to the id of the last root read |
| `comments_after: <id>` | at most 50 rows with a greater id, roots and replies alike, including replies under questions, flat and oldest first; `truncated` says more follow, and the next page starts after the last id read. `0` reads from the first |

A reply to an old thread moves that thread up in the read without a mode, so
news is not lost behind five newer roots. Comment ids run across items, so the
id `comments_after` names need not belong to this item: a reader that keeps the
id of the last comment it read takes only what came since.

`replies` counts the thread's replies. `last_reply` is the newest of them, or
`null` with none:

```json
{"id": 57, "author": "user", "by_person": true, "at": "2026-11-03T10:12:00.000000Z",
 "body": "Agreed, take the second option."}
```

Its `body` is cut at 500 characters, and a cut one carries `clipped: true`.

#### The sessions part

`sessions` lists the agent sessions whose confirmed calls wrote to the item, in
the order each first wrote there.

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

#### The commits part

**Since 3.0.** `commits` lists the commits attached to the item now, the newest
attachment first. Valkama attaches the commits a session makes; a caller
attaches one by hand with the `commits` group of
[Several changes in one call](#several-changes-in-one-call). A commit a rewrite
replaced is not listed: its attachments moved to the commit that replaced it.
`delete_work_item` takes the item's attachments with it, and the commits stay.

```json
{"repository": "valkama", "display_name": "Valkama", "hash": "3f2a9c1…",
 "subject": "fix(hooks): read the record once", "committed_at": "2026-11-20T10:31:02+03:00",
 "session": "019a…", "agent": null, "attached_by": "server", "label": ""}
```

| Field | What it holds |
| --- | --- |
| `repository` | the registered project's id; `null` for a commit whose repository is not known |
| `display_name` | the project's name in the registry, read when the item is; `null` while the registry does not record the project, and beside a `null` `repository` |
| `hash` | the whole hash, in lower case |
| `subject`, `committed_at` | the commit's subject and committer time; `""` and `null` for a commit attached by its whole hash on a machine without the project's root |
| `session`, `agent` | the session and agent that made it; `null` for a commit no session reported |
| `attached_by` | `server` (Valkama, from the session's work), `manual` (a caller or a person) or `migrated` |
| `label` | the words the attachment was given, `""` without them |

#### Sections of the description

**Since 3.0.** A card carries its description whole; an agent that wants to
refresh one piece of a long one reads that piece by its key.

- A line that starts in its first column with one to six `#` and a space, and
  carries text, outside a fenced code block (```` ``` ```` or `~~~`), is a
  heading. Its section is the exact span of the description from that line to
  the next heading of the same or a higher level, blank lines included, so it
  holds its subsections. The text before the first heading is the section
  `(start)`, of level 0, and exists only when that text is not empty.
- A description without a heading is divided into paragraphs: the text between
  blank lines outside a fenced block, without its last line break.
- A heading's key is its text without the opening `#` marks and any closing run
  of `#`, with its spaces run together. A paragraph's key is `p` and the first 8 hex
  digits of the SHA-256 of its text with the spaces run together. A key repeated
  in one description takes ` (2)`, ` (3)` in order, and so does a heading that
  reads `(start)`. Keys compare without case.
- Nothing is stored: each read derives the keys from the text. A heading's key
  changes only when that heading is renamed or headings of the same text are
  reordered; a paragraph's only with its own text. The answer carries
  `revision`, so a reader sees whether the item changed.

`parts: ["sections"]` lists them: `[{key, level, chars}]` for a description
with headings, `[{key, chars, starts}]` for one of paragraphs, `starts` being the
paragraph with its spaces run together, cut at 60 characters with no ellipsis.
`section` with a key or a list of keys answers with those sections and their
text, `[{key, level, chars, text}]` (no `level` for a paragraph), in the
description's order; a key named twice is read once.

```json
{"reference": "MAIN-12", "revision": 14,
 "sections": [{"key": "Steps", "level": 2, "chars": 1012, "text": "## Steps\n\n…\n\n"}]}
```

A key the description does not have, a stale one included, is refused with
`invalid_request` rather than answered with another text:
`unknown section 'Nope'; sections are Goal, Steps, Notes`. The refusal names at
most 20 keys in order and counts the rest as `and N more`; a description with
no section says `sections are none`.

#### The full record over HTTP

The HTTP read `GET /api/planning/work-item` takes the same parts: `parts` as a
comma-separated list of part names, and `section`, which may repeat because a
heading may hold a comma. With either it answers with what the tool answers,
inside `work_item`, and reads `unresolved`, `thread`, `comments_after` and
`events` as the tool's modes. Without either it answers with the item's full
record, as before 3.0, and the parameters below are the cuts of that record.

The full record carries every current field of the item -- state, checklist,
links, refs, commits, summary, the lease as `claim`, its followers as `subscribers` --
with every comment and every history event, oldest first, and `mentions` with
`mentions_total`, the texts on other items that named this one (see
[Mentions](#mentions)). A cut adds `comments_total`, `threads_total`,
`unresolved_total`, `events_total` and `history_truncated`, true when fewer
threads, rows or events are shown than exist.

The full record carries no `sessions` and no `images`. It takes these cuts as
opt-in parameters:
`comments` and `events` (non-negative integers, each keeping that many of the
newest entries), `comments_after` and `sessions=true`. With both `comments` and
`comments_after` it keeps that many of the newest comments after the id. A count
that is not a non-negative integer
and a `sessions` other than `true` or `false` are refused with
`invalid_request`; an unknown item is `not_found` (404).

**Since 2.5.** The HTTP read stays flat: comments are rows in id order, each
with its `reply_to` and `reply_to_request`, and a reader groups them into
threads itself. Neither it nor the card's read through the exact space scope
(`GET /api/modules/planning/work-item`) caps how many comments or events it
returns: the web interface draws an item from the whole record, however long its
discussion and history are, and a client must not refuse a record for its length.
Without `parts` the same read takes the comment modes as cuts of the full record:
`unresolved=true` with
`comments_after`, `thread=<id>`, and `threads=<count>` for that many threads with
the latest activity. `unresolved` other than `true` or `false` is `invalid_request`.

**Since 2.5.** The card's read through the exact space scope also takes
`brief=true`, which answers in the same envelope with the brief record a space's
list carries instead of the full one: state, title, holder, steps and dates,
with `comment_count` in place of the comments and no history, links, refs or
agents. Its size does not grow with the item's history, and it is what a
preview of a reference such as `MAIN-12` reads. Any other value of `brief` is
refused with 400; an unknown item is 404 and a space that is not there is 409,
as for the full read.

### Commits on no card

**Since 3.0.** A commit a session made that no item holds waits on a list until
someone attaches it: the hook answer names it to the agent, and the interface
shows the list to the person. A commit is on it while it has a session, no item
holds it, and no rewrite replaced it. A commit migrated from a ref or attached by
hand never has a session, so it is never on the list; a session's commit
detached from its last item is on it again.

`GET /api/planning/commits/unattached` reads it by one scope:

- `space=<key>` — the commits of the projects the registry binds to the space,
  its default project among them;
- `project=<id>` — the commits of one registered project, bound to a space or
  not;
- neither — every commit of the store on no card, whatever its project. The
  registry gives only the names here, and when it cannot be read every
  `display_name` is `null`.

```json
{"total": 2,
 "items": [{"repository": "valkama", "display_name": "Valkama", "hash": "3f2a9c1…",
            "subject": "fix(hooks): read the record once",
            "committed_at": "2026-11-20T10:31:02+03:00", "session": "019a…",
            "agent": null, "client": "claude", "reported_at": "2026-11-20T07:31:04.120Z"}]}
```

`items` is newest first, by the committer time, with its offset as Git gives it;
`reported_at` is when Valkama learned of the commit. `repository`, `display_name`,
`hash`, `subject`, `committed_at`, `session` and `agent` mean what they mean in
[the commits part](#the-commits-part); `client` is `claude` or `codex`, the
client whose hook reported it.

- `since=<time>`, an ISO time with its offset or `Z`, keeps the commits made at
  that time or later.
- `limit` is how many items the answer lists: 100 when it is left out, 0 to 500.
- `total` counts every commit the scope and `since` keep, however many `limit`
  lists.

Each refusal is `invalid_request` (400): both scopes
(`[commit] the commits on no card are read by a space or by a project, not both`),
a project the registry does not record
(`[commit] <id> is not a registered project: <ids>`), a space the store does not
have (`no planning space named <key>`), a registry that cannot be read for a
space or a project, a `since` without its offset or that is no time, and a
`limit` above 500 or below 0.

`POST /api/planning/work-item/commit` attaches one of them, or with
`"remove": true` detaches a commit, as one entry of the `commits` group of
[Several changes in one call](#several-changes-in-one-call) does, and is
refused as that entry is, by the same `[commit]` texts:

```json
{"reference": "MAIN-12", "repository": "valkama", "hash": "3f2a9c1"}
```

It takes no other field. Written from the interface, it is the person's write:
the attachment is `manual`, and it and its `commit_attached` or
`commit_detached` event are signed by the person. The answer names the item and
the revision it is at, the commit as the item's record lists it (as it is
attached now, or once detached as it was; `null` for a commit a rewrite
replaced, which the record does not list) and whether the write changed
anything; attaching a commit the item holds already changes nothing.

```json
{"reference": "MAIN-12", "revision": 7,
 "commit": {"repository": "valkama", "display_name": "Valkama", "hash": "3f2a9c1…",
            "subject": "fix(hooks): read the record once",
            "committed_at": "2026-11-20T10:31:02+03:00", "session": "019a…",
            "agent": null, "attached_by": "manual", "label": ""},
 "changed": true}
```

### The net at a close

**Since 3.0.** A commit no hook reported -- one a person made, a client without a
session, a session whose hook is off, or `git am` and a commit inside
`rebase -i`, which fire no commit hook -- reaches no item on its own. So an
agent's transition into a `review` or `completed` state names the commits made
in the card's repositories since the card was taken, and attaches none of them:
the agent attaches the ones that belong with the `commits` group of
[Several changes in one call](#several-changes-in-one-call).

The window opens where the work began, read in the same write before the
transition ends the claim, by the first of these that holds:

1. the item is claimed: when the call that claimed it arrived;
2. it is not, and the caller's holder holds one of its steps: the newest claim or
   takeover of that step by a call of the caller's session, the earliest of them
   when it holds several;
3. neither: the newest claim or takeover of the item by a call of the closing
   session, as for a close from review, whose entry ended the claim;
4. none of these: there is no window, and the answer says nothing of commits.

Once the transition has committed, the records the commit hook left that no
client hook has taken yet -- the closing session's and those of a commit in the
card's projects -- are taken first, in a transaction of their own and in the
order they were written across every session, so a commit a hook did report is
known before anything is named. Then Git is asked, outside any
transaction and for at most 5 seconds, in each root of the card's projects that
is on this machine with a repository of its own:
`git log --branches --tags HEAD --since=<window>`. Of what it lists, a commit is
named when its committer address is the one Git commits with in that root
(`git var GIT_COMMITTER_IDENT`, the environment and then the configuration) and
the store does not hold it for that project. `refs/stash`, a remote's branches
and the notes are not read, and a commit somebody else committed into a local
branch, such as one a pull brought, has another address. A commit of the same
address from another machine, pulled into a local branch while the work was
held, is named too; the agent leaves it. So is the copy a rebase in the window
makes of a commit Valkama did not know: its committer time falls in the window,
and its address is the session's own.

Only an agent's close runs the net. A person's transition in the interface
does not, and its HTTP answer carries none of these fields: the line speaks to
an agent and offers the `commits` group, which a person does not have. The
answer of the agent's transition -- the acknowledgement and the `verbose` card
of `apply_work_item_changes` -- carries each field only when it is not empty:

| Field | Holds |
| --- | --- |
| `unreported_commits` | up to 20 commits, newest first, each `{repository, hash, subject, committed_at}` as [the commits part](#the-commits-part) means them |
| `unreported_total` | how many there are, when there are more than the 20 listed |
| `unreported_unread` | the ids of the projects whose root did not answer: the transition stands all the same |

A line among the answer's `warnings` names them to the agent: "These commits in
the card's repositories were made since the card was taken and no hook reported
them: valkama 3f2a9c1d0, valkama 7b1e2a9c4 and 3 more. Attach the ones that
belong here with the commits group." The card was taken when the window above
began: by its claim, by a step's claim or by the session's last claim of it.

```json
{"reference": "MAIN-12", "state": {"key": "review", "name": "Review", "is_terminal": false},
 "applied": {"transition": {"state": "review", "released": "codex (session 019a…)"}},
 "unreported_commits": [{"repository": "valkama", "hash": "3f2a9c1d0…",
                         "subject": "docs: note the limit",
                         "committed_at": "2026-11-20T10:31:02+03:00"}]}
```

### Pictures on an item

A picture pasted into an item's text in the web
interface is kept for that item, and the text names it as
`![name](</api/images/<sha256>>)`. The `images` part of `get_work_item` lists every
picture the item keeps, oldest first:

```json
{"sha256": "9f86d0…", "media_type": "image/png", "size": 48213,
 "created_at": "2026-11-09T10:12:00.000000Z", "path": "/api/images/9f86d0…"}
```

`read_work_item_image` takes the item's `id` and the picture's `sha256` and answers
with two content blocks: `{"type": "image", "data": <base64>, "mimeType": <type>}`
and a text block with `sha256`, `media_type` and `size`. A hash the item does not
keep is `not_found`, even when another item keeps it. `media_type` is one of
`image/png`, `image/jpeg`, `image/webp` and `image/gif`, decided by the file's first
bytes, and a picture is at most 10 MB. The full record of the HTTP read does not
carry `images`; an HTTP read that names the part does.

Reading a picture hands its bytes to the agent's client, which passes them to its
model provider with the rest of the conversation: a screenshot leaves the machine
the moment an agent reads it. The `images` part lists only what each picture is, so
an agent calls `read_work_item_image` only when its task needs what the picture
shows.

Deleting an item deletes every picture no other item keeps; a merge carries the
pictures of the merged item to the survivor.

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

**Writing a reply.** The `comment` group of `apply_work_item_changes`, each
entry of its `comments`, and the HTTP write `POST /api/planning/work-item/comment`
take two optional fields, `reply_to` (a comment id) and `reply_to_request` (a
question's `request_id`); naming both is refused with `invalid_request`, and so
is a parent on another item. The answer adds the root the reply landed under, in
`applied.comment` for the batch, and both keys are `null` for a new root; the
HTTP write answers:

```json
{"work_item": "MAIN-12", "comment_count": 9, "comment_id": 46,
 "reply_to": 41, "reply_to_request": null}
```

A report takes no parent. A reply, like a comment, writes no history
event and changes no revision. A reply in a resolved thread leaves the mark in
place; to reopen the discussion of a resolved root, write a new root that names
it.

**The resolved mark.** A root comment or report can be marked resolved, with a
short decision of one line and at most 280 characters, which may be empty. A
reply cannot, and a question's thread has none: a question has its own status.
An entry of the `resolutions` group of `apply_work_item_changes` takes
`comment_id`, `resolution` and `reopen`, and
`POST /api/planning/work-item/comment/resolve` takes:

```json
{"id": "MAIN-12", "comment_id": 41, "resolution": "Moved to MAIN-14", "author": "codex"}
```

`resolution` may be left out, which is a blank decision. `reopen: true` in place of
`resolution` removes the mark; naming both is refused with `invalid_request`, and so
is a decision of two lines. The answer names the root and its mark as it now stands,
`null` after a reopen, in `applied.resolutions` for the batch; the HTTP write
answers:

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
and removed it and when. The mark is a write like any other, and its answer
carries `from_person`. A mark set in the interface is a person's act and is told
to the agent working the item (see
[What a person did reaches the agent](#what-a-person-did-reaches-the-agent)).

### A comment that waits for a reply

**Since 2.6.** An agent that is about to end its turn to wait for another agent
asks with `awaits_reply: true` on the comment that asks: the batch's `comment`
and each entry of `comments`, and the HTTP write of a comment take it, on a
root or a reply, beside `mentions` too. Anything but a boolean is refused with
`invalid_request`. A comment that only informs does not set it.

A comment that waits says so in every read, with whether it has been answered:

```json
{"id": 41, "kind": "comment", "author": "codex", "by_person": false,
 "body": "Which parser does the export use?", "reply_to": null,
 "reply_to_request": null, "awaits_reply": true, "answered": false, …}
```

`answered` turns true with the first later reply in the same thread written by a
person, or by a confirmed session other than the one whose call wrote the comment;
a reply from the asker's own session, its subagents included, is not an answer.
The thread's resolved mark does not change `answered`, but the wait follows it: a
comment in a resolved thread does not wait, and once the thread is reopened an
unanswered one waits again. A reply written while the thread is resolved answers it
without waking the asker. A comment that does not wait carries neither key. The flag writes no event and
changes no revision, as a comment does not. What it makes the client hooks do, wake
the holders of the item and of the items named in `mentions` and then the asker
with the answer, each once, is in the
[hook contract](hook-contract.md#when-another-sessions-news-wakes).

### The address of a work item

`GET /open/<reference>` opens one work item in the web UI, so that an agent can
hand a person a link built from nothing but a number. A client does not turn a
bare number into a link, and the address of a card itself cannot be written from a
number: it names the store and the space.

The reference is read as a search reads one, so `main-12` is `MAIN-12`, and its
prefix names the space. The route is a loopback address under the same `Host` rule
as every other, and it answers:

| The address | Answer |
| --- | --- |
| names an item, followed by a person, with the desktop app installed | `200` and a small page, after starting the app on the card; see below |
| names an item, in any other case | `302` to `/modules/planning/space/<data_scope_id>/<KEY>?entity=<entity>`, the route the card has when it is opened any other way, with `Cache-Control: no-store` |
| is exactly `/open/questions` | as for an item, but the panel of open questions in place of a card; see [The panel of open questions](#the-panel-of-open-questions) |
| names anything else | the app page with `404`, which says what is wrong and offers the next step |
| reaches a store or a project registry that cannot be read | the app page with `503`, which offers another try |

The redirect is the card's own route, so the address bar, Reload and Back behave
as they do after any other navigation. Nothing the address says reaches the
redirect but a reference the grammar accepted and a store confirmed, and the
surface checks the result against the one shape a card route has: `/open//evil`,
`/open/https:%2F%2Fevil` and the like get the app page, never a `Location`. Primary
and attached stores can each keep a space with one key; the primary answers first.
Every space has a card route, whether or not a project is bound to it. The shell
also opens on the project route a card had before 3.0,
`/modules/planning/project/<project>`, so a kept bookmark lands in the app rather
than on an error; what it shows there is the shell's to say.

The page reads why from `GET /api/modules/planning/search`, whose coverage names
each source it read and each it could not: a number nobody filed, a key no store
here holds, and a store that did not answer read differently, and an item is never
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

A work item's card in an MCP answer (`get_work_item`, a `verbose` write,
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

A `relates-to` link is one link whichever end names it. Linking it from
the other end, or again from the same one, adds nothing and writes no history;
`remove: true` from either end takes it away, and the history of both items says
so. The store refuses a second record of it. A store in which an earlier build
recorded one relation twice, once from each end, keeps the earlier record when
it is opened, after a verified recovery point labelled `prerelatesonce`. Every
reader therefore sees the link once: `outgoing` from the item that wrote it and
`incoming` from the other. `blocks`, `discovered-from` and `duplicates` stay
directed, and only the end that wrote one removes it.

A reader judges a link by the item at its far end: a `blocks` link holds only
while its blocker is unfinished, and that blocker may live in another space,
under another workflow. So a link names that end's state itself, and nobody has
to read the other item to know.

- In a work item's full record (`GET /api/planning/work-item`) and its `links`
  part, each link, in either direction, names its other end: `state_name`,
  `state_category`, `is_terminal` and `state_unavailable`.
- In a space's view (`links` in `GET /api/planning` and
  `/api/events?view=planning`, `edges` in `GET /api/planning/graph`), the view
  holds the space's items and other spaces' items that name one of its
  projects, as a list with `space` does, and every link with an end among them,
  in either direction and of every kind. So `from` or `to` can name an item the
  view does not hold, and `other_space_ends` names each such end: its
  `work_item_id`, `reference`, `title`, `kind`, `state` (`key`, `name`,
  `category`, `is_terminal`, or `null` for an accepted open goal or stage and
  for a state the store cannot resolve) and `space` as `{key, name}`. Each link
  names its source end, `from`: its `reference` and the same four state fields.
  A graph's `parent` edges carry none of them, and its nodes carry `other_space`
  as the items do. `project` beside `space` narrows the view as it narrows that
  list; without `space` it is refused.
- A chain's `edges` name their source the same way; see
  [Reading a chain of work](#reading-a-chain-of-work).

When the store cannot resolve that end's state, `state_name`, `state_category`
and `is_terminal` are `null` and `state_unavailable` is `state_missing`;
otherwise `state_unavailable` is `null`. An end whose state is unknown is not
open, and as a blocker it blocks nothing. A reader of an older server finds no
such fields and looks the end up among the items it holds.

The search across spaces, `GET /api/modules/planning/search`, marks each result
the same way: `item` carries `kind` and `priority`, and `item.state` carries
`category` and `is_terminal` beside its name.

### Reading a chain of work

A goal's tree is the work that was planned. Work found while doing it is
linked `discovered-from` the item it was found from, and often lands under
another goal or under none, so a goal can be closed with all its work done while
the work it started is still growing. A chain follows that growth.

For a root item and a scope, the members are:

- `tree`: every item under the root, at any depth.
- `chain`, the default: the root's children, then, repeated until nothing new is
  found, every item linked `discovered-from` the root or a member, and every
  child of a member.

The walk goes downward only. It never adds a member's parent and never follows
`discovered-from` from the item that was found to the item it was found from.
`relates-to`, `duplicates` and `blocks` never add a member. The root is never a
member, and members are always in the root's planning space.

`GET /api/planning/work-item/chain?id=<reference or work_item_id>&scope=chain|tree`
answers with `interface_version` and `chain`:

| Field | What it holds |
| --- | --- |
| `root` | `work_item_id`, `reference`, `title`, `kind`, `has_children`, true when any item names the root as its parent, and `totals`, how many members each scope holds (`chain`, `tree`) whichever scope was asked; everything under the root is always a member of its chain, so equal totals mean the two scopes answer the same members |
| `scope` | `chain` or `tree` |
| `total`, `closed`, `open`, `workable` | how many members there are, how many are closed, how many are open, and how many are `workable` |
| `by_category` | members per workflow category, for the categories that have any; an accepted open goal or stage has no category and is counted only in `by_container_state` |
| `by_container_state` | the accepted open goals and stages among the members, per `container_state` |
| `origins` | members grouped by their parent: `parent_reference` and `parent_title` (`null` for members without a parent), `count` and `open`. The root's own children come first, then the larger groups |
| `series` | one entry per UTC day on which a member was created or closed, oldest first: `day` (`YYYY-MM-DD`), `created`, `closed`, and the running totals `total` and `closed_total` |
| `recent` | the last 7 UTC days, today included: `days` (7), `created`, `closed`, and `trend`, which is `growing` when more were created than closed, `converging` when fewer, and `steady` otherwise |
| `members` | every member, in the order of work: `work_item_id`, `reference`, `title`, `kind`, `state` (`key`, `name`, `category`, `is_terminal`, or `null`), `open`, `container_state`, `claim_ref`, `claim_state`, `parent_reference`, `created_at`, `closed_at`, `workable` and `queue_order` |
| `edges` | the `discovered-from` links whose two ends are the root or members, and every `blocks` link into the root or a member, wherever its source lives: `from`, `to` (work item ids), `kind`, and the source's `reference`, `state_name`, `state_category`, `is_terminal`, `state_unavailable` and `container_state` |

A member's `closed_at` is when it last changed state, if its state is terminal:
the time of its latest transition, or of its last update when it never had one.
It is `null` for an open member. `workable` is the rule every work item record
uses (see [The work model](#the-work-model)).

An edge names its source because a member waits on its blocker whether or not
that blocker belongs to the chain, or to the space, so `from` need not be a
member. When the store cannot resolve the source's state, `state_name`,
`state_category` and `is_terminal` are `null` and `state_unavailable` is
`state_missing`; such a source is unknown, not open, and blocks nothing.

The members come in the total order of every read of many items, as described in
[The order of work](#the-order-of-work), not by number. A member's `queue_order`
is its place in its space's queue, as a list row's is, and `null` when the queue
does not give it. It is counted over the space, not over the chain: a gap means
work outside the chain is given between them.

A `scope` other than `chain` or `tree` is refused with `invalid_request`, and
`epic` names `tree` in its refusal; an unknown item is `not_found` (404), as on
`GET /api/planning/work-item`.

The MCP tool `get_work_item_chain` takes `id`, `scope`, `offset` and `limit`, and
answers with the same fields except `members` and `edges`, with only the newest
30 entries of `series`. In their place it carries `open_members`, one compact
row per open member: `reference`, `title`, `state` (the key, or `null`),
`container_state` when it has one, `claim_ref`, `workable`, `parent_reference` and
`queue_order`. They come in the order a reader acts on them: active members, then
members in review, then workable ones, then the rest,
each group in the order of `members`. The rows are paged like a list: at most `limit` per answer, 50
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

A request's tokens count once in the whole store, even when a client copied its record
into a second transcript. The request counts in one run: a session's own before a
subagent's, then the run whose first record is earlier, then the one read first. A
subagent transcript's records that name another session are copies and count nothing.
A run whose rows an older reading wrote, or whose model has since been priced, is read
again in the background once nothing new is left to read, so its numbers can change
after they were first read.

Each stretch of work also records what it ran under, as far as its transcript says, and
ends where any of it changes: the organization its requests were made for (at Codex, the
account that created the thread), how the client ran (`ide`, `terminal`, `app` or
`headless`, with `@wsl:<distribution>` for a transcript written in WSL), the effort the
requests ran with, and the adviser its turn had configured. An advisor call's tokens are
a stretch of their own with no time, flagged as an advisor's, even when the advisor runs
the executor's model. A change of any of these changes nothing about what the time counts
as. A Claude subagent's run records the class its launch description declares in front of
a colon, and keeps the first one recorded. What a transcript does not say, or says as
something other than a short label, stays unknown. An item's read below returns the
account, the launch class, the effort and who did the work; the session's read does not.

`GET /api/planning/work-item/usage?id=<reference or work_item_id>&scope=item|chain|tree`
reads one item, or with `chain` or `tree` the item with the members
[its chain](#reading-a-chain-of-work) has in that scope. `GET
/api/planning/session/usage?session_id=<id>` reads one session with its subagents. Each
answers with `interface_version` and `usage`:

| Field | What it holds |
| --- | --- |
| `elapsed_seconds` | the union of the rows: two agents working one hour side by side on one item took one hour. Between items an overlap is real parallel work, so items may add up to more than their session or goal |
| `agent_seconds` | the sum of the rows: those two agents spent two hours. This one always adds up |
| `tokens` | `input`, `cached_read`, `cache_write_5m`, `cache_write_1h`, `output` and `reasoning`, each `null` when no request reported that kind. `input` excludes the cache at both clients. `reasoning` is the part of `output` spent on reasoning. `cache_write_5m` holds a client's shorter cache retention and `cache_write_1h` its longer |
| `estimated_api_cost_usd` | what the requests would cost at public API prices, per request, since a price depends on a request's size; `null` when no request has a known price |
| `cost_basis` | what that number is: an estimate, and not a bill, since a subscription pays differently |
| `unpriced_models` | models that spent tokens and have no known price. They add nothing to the cost, so a cost is as complete as this list says |
| `unpriced_tokens` | how many tokens the cost leaves out: the `input`, `cached_read`, `cache_write_5m`, `cache_write_1h` and `output` of every stretch of work with no cost at all, and `0` when there is none. `reasoning` is part of `output` and is not counted again. A stretch holds one model, so a model with no price is counted in full; a request with no price among priced requests of its model, such as one at a speed with no price, is not. A surface prints it beside the cost rather than presenting an undercount as the cost |
| `agents` | by run: `session_id`, `agent_id` (`null` for the session's own), `seconds`, `tokens`, `estimated_api_cost_usd`, `unpriced_tokens` |
| `models` | `model`, `seconds`, `tokens`, `estimated_api_cost_usd`, `unpriced_tokens`. A model only called on the side has no seconds of its own |
| `signals` | `signal` (`null` for no item), `seconds` and `share` of the time |
| `quality` | `observed`, `estimated`, `mixed`, or `null` when no time was counted; `estimated_seconds` says how much |
| `by_item` | one line per item: `work_item_id`, `reference`, `title`, `elapsed_seconds`, `agent_seconds`, `tokens`, `estimated_api_cost_usd`, `unpriced_tokens`. A chain's starts at its root and lists every member; a session's lists the items it worked on, then its line with no item, whose `work_item_id` is `null`. An item since deleted keeps its id, with a `null` number and title |

An item's read adds `work_item_id`, `reference`, `title` and `scope`, and says who spent
the work, under which account and how much of each account's week it took:

| Field | What it holds |
| --- | --- |
| `sessions` | how many sessions worked on the item, or with `chain` or `tree` on any of its members: each session whose stretches of work went to it, with its subagents', and each session whose confirmed write calls acted on it, counted once. It can be larger than the list of sessions on the item's card, which holds only the writers |
| `quota` | `weeks` and `unknown_share`, below |
| `account_stretches` | the work in time order, one line for each run of stretches under one account: `account`, `started_at` (its first stretch's start), `ended_at` (the latest end among them), `seconds`, `tokens`, `estimated_api_cost_usd`, `unpriced_tokens`. Two neighbouring lines never share an account, and an unknown account is a value of its own, so not every line after the first is a change of account: a change is a line under a known account after one under a different known account, with or without lines under an unknown account between them, and a line under an unknown account is never one. `a`, unknown, `a` has no change; `a`, unknown, `b` has one, where `b` starts. Stretches of agents working side by side follow one another by their start |
| `accounts` | each account the work ran under, the most time first, then the most cost: `account`, `share` of `agent_seconds`, and the same figures |
| `roles` | the work by who did it, ranked the same way: `role` — `main` for the session's own agent, `subagent`, or `advisor` for an adviser's own calls, whoever it advised — with `launch_class`, `effort` and the same figures |

`account`, `launch_class` and `effort` each carry `id` and `unknown`, as a value of the
[period read](#what-agent-work-spent-in-a-period) does. `account` is the organization the
requests were made for. `unknown` is `true` where the store does not hold the value: an
account or an effort the transcript did not say, a subagent's class nobody recorded. A
value that is none by its nature has an `id` of `null` and `unknown` `false`: the launch
class of the session's own agent. An adviser keeps the class of the run it advised in and
the effort its segment holds, as the period read's `role` does, so `roles` added up by
`role` and `launch_class`, or by `role` and `effort`, gives the groups of that read's answer
for the item grouped the same way over a period that holds all its work, with the same
tokens, and seconds and costs within the bound below.

The `seconds` of each of these lists add up to `agent_seconds` and their costs to
`estimated_api_cost_usd` exactly, in thousandths of a second and millionths of a dollar,
and their tokens and `unpriced_tokens` to the item's. A line's figure is what the lines up
to it add up to, rounded, less what those before it do, so it is within one unit of its
own and the last line ends on the item's total. A line whose stretches had no price has a
cost of `null`.

This read and the period read round in different places. This one adds up a line's
segments and then rounds, as above; the period read rounds each segment to a whole millisecond and a whole
millionth of a dollar, half up, and then adds. So where `m` lines of `roles` add up to a
group of the period read that holds `n` segments, the two figures differ by at most
`m + n / 2` units, a thousandth of a second or a millionth of a dollar: each line is within
one unit of what its segments add up to, and each segment the period read adds is within
half a unit of its own figure. Three segments of 10.0004 s at $0.0000304 each make one line
of 30.001 s and $0.000091 here, and 30.0 s and $0.00009 in the period read. Where every
segment's seconds and cost are whole units, the two are equal.

`quota` is the item's part of each account's weekly quota, for the same stretches of work
as the rest of the read, so with `tree` for the whole tree. Each stretch is on the seat the
[quota samples](#subscription-quota-samples-and-accounts) put it on. `weeks` has one line per
seat the work was on, the latest week first:

| Field | What it holds |
| --- | --- |
| `account` | `organization`, and `account_uuid`, `null` for a seat no account, or two, can be shown to name |
| `seat` | the seat, which names one week of that account |
| `week_ends_at` | when that week resets |
| `share` | the item's cost at API prices on that seat, divided by the cost of every stretch on the seat that week, the item's and everyone else's; `null` when the seat's work that week had no cost |
| `week_used_percent` | how much of the week is spent, by the latest `week` sample of the seat; `null` with none |
| `percent` | `share` times `week_used_percent`, rounded to two places; `null` when either is |

`unknown_share` is the part of the item's cost on stretches with no seat that can be shown,
`null` when the item's work had no cost. No figure is a sum of percentages: lines of
different accounts and weeks are never added up, as in
[each account's quota](#each-accounts-subscription-quota). The figure assumes a quota is
spent in proportion to the API price, which no published formula confirms. It also leans
high: a week's percent holds work no stretch here records, such as another client's or a
chat in a browser, while the share counts only the recorded stretches.

A session's adds
`session_id`, `first_at`, `last_at`, `excluded` (`human`, `subagent`, `external` and
`gap` in seconds) and `runs`, one per transcript: `agent_id`, `client`, `status`
(`reading`, or `missing`, `truncated` or `unreadable` for one that cannot be read now),
`first_at`, `last_at`, `read_at` and its own `excluded`. For any run, work and
`excluded` add up to its span. A session not read yet reads empty rather than unknown.

The tools an agent calls do not carry these numbers: they would cost it context.

### What agent work spent in a period

The Analytics module reads the same usage rows over a period rather than for one item or
session: in total, by up to two dimensions, step by step, and beside the period before.
It answers `GET /api/analytics/usage` with `interface_version`
`valkama-analytics-api` and `usage`. A later build only adds fields to this answer. No
MCP tool reads it, for the same reason as above.

| Parameter | What it takes |
| --- | --- |
| `from`, `to` | required. A date, `2030-03-04`, meaning the start of that day at `utc_offset`, or a time with its own offset, `2030-03-04T09:00:00Z` or `2030-03-04T09:00:00%2B03:00`: in a query string a `+` reads as a space, so it is sent as `%2B`. `to` is not included and must be later than `from`. Both, and with `compare` the period before too, lie between 1970 and the start of 9999 |
| `step` | `day` (the default), `hour` or `minute` |
| `utc_offset` | the caller's offset from UTC in minutes, from `-840` to `840`; `0` by default. A day, an hour or a minute of the series starts at the caller's midnight, full hour or full minute. The server has no time-zone database: a period across a change of daylight saving time is cut at one offset, so a caller that minds asks for it in two |
| `group_by` | none, one or two dimensions, separated by a comma: `account`, `project`, `work_item`, `executor`, `role`, `launch_class`, `model`, `effort`, `environment`, `seat` |
| a dimension's name | a filter: the values admitted, separated by a comma, up to 100 of 1 to 512 characters; `role` takes only `main`, `subagent` and `advisor`. A work item is named by its `work_item_id`, an executor by its session id, a project by its `project_id`, a seat by its `id` |
| `none` | the dimensions, separated by a comma, whose missing value a filter admits: work on no item for `work_item`, a session's own run for `launch_class`, work on an item that names no project for `project`, an unknown value for the rest. `none=launch_class` does not admit a subagent's run whose launch class is unknown, `none=project` does not admit work whose project is unknown, and `none=role` admits nothing, since every stretch has a role. Alone it keeps only the work with no value there |
| `compare` | `true` adds the preceding period of the same length; `false` by default |

A filter admits a stretch of work when its value is among those named, and every filter
must admit it. A parameter given with an empty value, `model=` or `none=`, is taken as
not given, as on the reads above. A period may hold at most 2,400 steps: forty hours by
the minute, a hundred days by the hour. Any other parameter, a repeated one, a value out of its range or a list with an empty entry, such
as `model=m-1,,m-2`, is refused with `400` and
`{"error": {"code": "invalid_request", "message": …}}`, the shape the reads above refuse
with.

```json
{"interface_version": "valkama-analytics-api",
 "usage": {
   "period": {"from": "2030-03-04T00:00:00+03:00", "to": "2030-03-06T00:00:00+03:00",
              "step": "day", "utc_offset": 180},
   "group_by": ["work_item"],
   "cost_basis": "An estimate at public API list prices for each request. …",
   "last_event_at": "2030-03-05T18:12:40.512Z",
   "total": {"agent_seconds": 5400.0, "estimated_seconds": 0.0, "quality": "observed",
             "tokens": {"input": 1060, "cached_read": 20000, "cache_write_5m": 300,
                        "cache_write_1h": null, "output": 408, "reasoning": 2},
             "estimated_api_cost_usd": 0.26, "unpriced_tokens": 57,
             "unpriced_models": ["claude-unknown-9"]},
   "rows": [{"group": {"work_item": {"id": "6f1c2a8e-0000-4000-8000-000000000010",
                                     "unknown": false, "reference": "MAIN-12",
                                     "title": "Answer a review in one form"}},
             "agent_seconds": 3600.0, "…": "the measures"},
            {"group": {"work_item": {"id": null, "unknown": false,
                                     "reference": null, "title": null}},
             "agent_seconds": 1800.0, "…": "the measures"}],
   "series": [{"start": "2030-03-04T00:00:00+03:00", "end": "2030-03-05T00:00:00+03:00",
               "agent_seconds": 0.0, "…": "the measures", "groups": []},
              {"start": "2030-03-05T00:00:00+03:00", "end": "2030-03-06T00:00:00+03:00",
               "agent_seconds": 5400.0, "…": "the measures",
               "groups": [{"group": {"work_item": {"…": "as in rows"}},
                           "agent_seconds": 3600.0, "…": "the measures"}]}],
   "comparison": null}}
```

| Field | What it holds |
| --- | --- |
| `period` | the period and step asked for, with `from` and `to` at the caller's offset |
| `group_by` | the dimensions asked for, in order |
| `cost_basis` | what the cost is: an estimate at public API prices, not a bill |
| `last_event_at` | the newest transcript record read into the store, of any session, so a screen can say how fresh the numbers are; `null` before anything was read |
| `total` | the measures of the whole period, and `unpriced_models` as the reads above give it |
| `rows` | one line per group of values that spent anything, the most time first: `group`, one value per dimension of `group_by`, and the measures. With no `group_by` it is one line with an empty `group` |
| `series` | one point per step, oldest first, every step present: `start`, `end`, the measures, and `groups`, the step broken down by the groups of `rows`: by the one dimension of `group_by`, or by the pair of both with two, each `group` naming every dimension as a row's does; empty with none |
| `comparison` | with `compare=true`, `period` (`from`, `to`), `total` and `rows` of the preceding period of the same length; otherwise `null` |

The measures are the reads' above: `agent_seconds`, `estimated_seconds`, `quality`
(`observed`, `estimated`, `mixed`, or `null` when no time was counted), `tokens` by
kind, `estimated_api_cost_usd` and `unpriced_tokens`, each with the meaning given
there. The answer holds no subscription quota and no percentage of any limit: `seat`
says only which account the work was spent on.

Seconds here are `agent_seconds` only: the sum of each stretch of work's own seconds.
Two agents working one hour side by side spent two hours, a subagent's time counts
beside its coordinator's, and nothing is taken as a union. The union, `elapsed_seconds`
above, is not given, because it does not add up across groups or steps. These do: the
rows add up to `total`, the points of `series` add up to `total`, a point's `groups` add
up to the point, and the `rows` of `comparison` add up to its `total`, exactly: each
stretch of work is counted in whole units, a millisecond, a millionth of a dollar and a
token, and the figures are published at that precision.

A stretch of work that crosses a step boundary or an edge of the period is split in
proportion to its time. What it has spent of a figure by a moment is that figure times
the share of its time before the moment, rounded half up to a whole unit; what it spends
between two moments is the difference. So what falls between two moments depends on
those moments alone: a period's total is the same by the minute, by the hour and by the
day, with `compare` and without, and two adjacent periods add up to the one they make. A stretch
with no length, a model called on the side, counts whole in the step that holds its
moment.

A period that holds the whole store gives the same figures as the per-session reads
above added up, and an item's row the same as that item's read, with tokens equal and
seconds and cost to within the rounding of each stretch: half a millisecond and half a
millionth of a dollar per stretch, and the rounding of each read's own sum.

A value in `group` carries `id` and `unknown`, which is `true` when the store does not
hold the value; such a value is its own group and no string stands in for it. Work on no
item, for `launch_class` a session's own run, and for `project` work on an item that names
no project or several, are groups of their own too, with an `id` of `null` and `unknown`
`false`: there is nothing to know.

| Dimension | Value | Beside `id` |
| --- | --- | --- |
| `account` | the organization the work was billed to, as the usage rows hold it; unknown until the reader fills it | — |
| `project` | the project the item names (see [The projects an item changes](#the-projects-an-item-changes)), in whichever space the item lies; a goal or stage names the projects of the tasks under it. An item that names several is one group of its own, `id` `null` and `unknown` `false`, rather than a share in each, so the groups still add up to the total; an item that names none is its own group too, with `combinations` `null`. A filter admits an item by any project it names, so a project's row in a breakdown is smaller than the filter on it by the work on items naming several, and `none=project` admits the items that name none. For work on no item, the project whose registered root holds the session's folder, the folder that places it in the live-work frame (see [The live-work frame](#the-live-work-frame)). Unknown when the item is gone, the session has no folder or no root holds it, and for work on no item whenever the projects registry cannot be read | `name`, as the projects registry gives it, or `null`; `combinations`, on the group of several, every set of projects the work in that group names, each a list of `{"id", "name"}` by id, the sets ordered by their ids; `null` on every other value |
| `work_item` | the item the work is counted to | `reference` and `title`, `null` for an item since deleted |
| `executor` | the session a card's holder opens: a subagent's work is its session's | `family`, `opened_in` and `opened_host`, as a card's executor gives them, and `title`, the name its client gave the session, as the live work beside the board names it, or `null` when there is none to read. Not its live `state`, which changes while the period's figures do not |
| `role` | who spent it: `main`, a session's own run; `subagent`, a subagent's run; `advisor`, an adviser the agent consulted, in whichever run it was. Never unknown. An adviser's row keeps the launch class, effort and model its segment has, so `role` beside `launch_class` or `model` tells whose adviser it was and which model advised | — |
| `launch_class` | how a subagent's run was launched, as the usage rows hold it. A session's own run is launched by no one, so it has none (`unknown` `false`); a subagent's run that does not say is unknown | — |
| `model`, `effort`, `environment` | as the usage rows hold them | — |
| `seat` | the subscription account of its organization the work was spent on, read from the quota samples when the answer is made: a stretch is on the seat the latest sample of each feed at or before it says, until that window resets, its own session's feeds first. The `id` is the organization, a `/` and the account's UUID, or, for a seat no sample with a UUID names in that organization that week, the seat's key for the week, `week:2030-03-08T09:00Z`, which does not hold across weeks. The same UUID in two organizations is two accounts. Unknown where the work names no organization or no sample of it says where it was: one group, never counted to an account | `organization`, `account_uuid` and `seat_key`, the parts of the `id`; all `null` when unknown |

The answer carries ids, the names and numbers a card already shows, times and counts.
It holds no path and no folder. The one text from a transcript is an executor's
`title`: Claude Code writes the name it shows for a session into the session's
transcript, a name a person gave winning over the one it made, and the server reads it
from the file's tail, where the live work reads it, and keeps it nowhere. Another
client's transcript is not read, so a Codex session's `title` is `null`. A transcript is
read once per answer and again only after it changed, so a period of many sessions
costs the status of their files once each has been read. Because a person can rename a
session, the `title` is one of two values in the answer that two reads of the same rows may
give differently. The other is `seat`: a quota sample that arrives later, such as imported
history, can say where earlier work was, and one that names an account's UUID turns a seat's
key into its account.

### How much work stands and what it took

The Volumes read counts the work of a scope by where it stands: how much waits in each
category now, which card has stood there longest, and how much came to be completed or
cancelled in a period, what waits for the owner, which commits stand on no card, what
each goal took, what work stands outside goals, and how work flowed day by day. It answers
`GET /api/planning/volumes` with `interface_version` `valkama-planning-api` and
`volumes`; `GET /api/planning/goal-volumes` gives the rows of the goals and stages it is asked for,
whole (see [A goal's row](#a-goals-row)). A later build only adds fields and sections to
these answers. No MCP tool reads them: the numbers would cost an agent context.

| Parameter | What it takes |
| --- | --- |
| `scope_kind` | required: `global`, every space of the store this service writes, or `space` |
| `data_scope_id`, `space_key` | with `space`, required: the space, named exactly as the shell names it |
| `project_id` | with `space`, optional: a project, which narrows the space to the items that name it |
| `from`, `to` | required: a date or a time with its offset, as in [What agent work spent in a period](#what-agent-work-spent-in-a-period). The period holds at most 2,400 days |
| `utc_offset` | required: the caller's offset from UTC in minutes, from `-840` to `840`; a date means the start of that day at it |
| `kind` | optional, repeatable: `task`, `bug` or `improvement`; the read keeps the tasks of any kind named (see [Filtering by kind and label](#filtering-by-kind-and-label)) |
| `label` | optional, repeatable: a label; the read keeps the tasks carrying every label named |

A space's scope holds the items the space's board holds, so a number opens the board on
the same work: the space's items, and the items of other spaces that name one of the
projects the registry binds to the space, as `list_work_items` reads a space (see
[Tool results](#tool-results)). A goal or stage names what the tasks under it name, at
any depth. With `project_id`, the scope keeps the space's items that name the project,
and other spaces' items that name it when it is one of the space's projects; a project
of another space that the space's items name keeps only the space's own.

```json
{"interface_version": "valkama-planning-api",
 "volumes": {
   "scope": {"kind": "space",
             "space_ref": {"data_scope_id": "6f1c2a8e-0000-4000-8000-000000000001",
                           "space_key": "MAIN"},
             "project_ref": null},
   "period": {"from": "2030-03-04T00:00:00+03:00", "to": "2030-03-11T00:00:00+03:00",
              "utc_offset": 180},
   "filter": null,
   "measured_from": "2030-02-17T16:03:29.000Z",
   "counts": {
     "categories": [
       {"category": "triage", "tasks": 40, "goals": 1, "stages": 1,
        "oldest": {"work_item_id": "6f1c2a8e-0000-4000-8000-000000000012",
                   "reference": "MAIN-12", "since": "2030-01-03T10:00:00Z"}},
       {"category": "completed", "tasks": 31, "goals": 1, "stages": 0, "oldest": null},
       {"…": "the other six categories"}],
     "waiting_owner": {"count": 12,
                       "oldest": {"request_id": "6f1c2a8e-0000-4000-8000-000000000090",
                                  "reference": "MAIN-90", "since": "2030-02-28T09:00:00.000Z"}},
     "unattached_commits": 3},
   "goals": [{"…": "a goal's row, with the rows of its stages in children"}],
   "outside": {
     "tasks": 43,
     "by_project": [
       {"project": {"id": "app", "unknown": false, "name": "App", "combinations": null},
        "categories": {"triage": 30, "deferred": 2, "ready": 3, "active": 1, "review": 0,
                       "completed": 4, "blocked": 0, "cancelled": 1}},
       {"…": "a row for several projects, and one for none"}],
     "by_label": [
       {"label": "ui", "categories": {"triage": 9, "…": "the other seven categories"}},
       {"label": null, "categories": {"triage": 21, "…": "the other seven categories"}}]},
   "flow": {
     "days": [{"day": "2030-03-04", "created": 14, "closed": 11, "decisions": 6, "commits": 9},
              {"…": "every other day of the period"}],
     "totals": {"created": 70, "closed": 64, "decisions": 24, "commits": 51},
     "pace": {"open": 640,
              "recent": {"days": 7, "created": 70, "closed": 64, "trend": "growing"},
              "series": [{"day": "2030-01-03", "created": 3, "closed": 0, "total": 3,
                          "closed_total": 0}]}}}}
```

| Field | What it holds |
| --- | --- |
| `scope` | the scope read: `kind`, `space_ref` (`{data_scope_id, space_key}`, or `null` for `global`) and `project_ref` (`{project_id}`, or `null`) |
| `period` | the period asked for, with `from` and `to` at the caller's offset |
| `filter` | the filter asked for, `{"kinds": [...], "labels": [...]}` with each in the order named and once, or `null` when the read names no `kind` and no `label` |
| `measured_from` | the start of the first stretch of agent work counted to an item in this store, as the usage rows hold it, or `null` when none is: an item started before it may have spent more than its usage says (see [How much work an item took](#how-much-work-an-item-took)) |
| `counts.categories` | the eight categories, every one, in the order of [The work model](#the-work-model): `category`, `tasks`, `goals`, `stages` and `oldest`; under a filter `goals` and `stages` are `null` |
| `counts.waiting_owner` | the questions to the owner still open on the scope's items: `count`, and `oldest`, the one asked first, with `request_id`, the `reference` of its item and its `created_at` as `since`, or `null` when none waits |
| `counts.unattached_commits` | how many commits stand on no card: the `total` of [Commits on no card](#commits-on-no-card) read by the project, by the space, or, for `global`, of the whole store; `null` when that list refuses the scope, a project only items name or a space or project read while the projects registry cannot be read, and the rest of the answer stands |
| `goals` | the scope's open goals and the goals that came to be completed or cancelled inside the period, by space key and number, each a [goal's row](#a-goals-row) |
| `outside` | the scope's tasks under no goal: `tasks`, how many, and the rows `by_project` and `by_label` (see below) |
| `flow` | how work flowed through the scope: `days`, `totals` and `pace` (see [The flow](#the-flow)) |

A category counts the items of the scope that stand in a state of it. An accepted open
goal or stage stands in no category and is in none of these counts. Work in an open
category is counted as it stands now; `completed` and `cancelled` count the items that
came to stand there inside the period, and only those. An item came to stand where it
is at its last state entry, the newest `created`, `transitioned` or `opened` event of
its history, or at its creation when its history holds none. `oldest` is the item of an
open category that came to stand there first, with that moment as `since`; it is `null`
for a category nothing stands in, and always for `completed` and `cancelled`. How long
ago that was is the reader's to say: the answer holds no clock of the server.

A question waits for the owner while it is pending, asks the owner rather than an agent
session, is no list on a comment, and has not run out past its deadline or with its
execution: the same test the owner's alert and the queue's `question` apply. The commits
on no card do not depend on which items the scope holds, only on its projects: those of
the project read, those the registry binds to the space, or every commit of the store.

`outside` counts the scope's tasks with no parent, each as the categories count it: in
an open category as it stands now, in `completed` or `cancelled` only when it came to
stand there inside the period; `tasks` is how many count. Each row says how many of its
tasks stand in each of the eight categories, all eight named, and the rows come with the
most tasks first. `by_project` gives each task one row, so its rows add up to `tasks`:
the project it names, its tasks naming several projects together, or those naming none.
`project` is written as the `project` group of
[What agent work spent in a period](#what-agent-work-spent-in-a-period) is: `id` and
`name`, as the projects registry gives it or `null`, with `unknown` `false`; the row of
several has `id` `null` and lists in `combinations` every set of projects its tasks
name, each as `{"id", "name"}`, which the other rows hold as `null`. `by_label` gives a
task the row of each of its labels, and a task with none the row whose `label` is `null`,
so those rows add up to no total.

The read counts the store this service writes, where usage is counted. A space of an
attached store is refused rather than counted short.

| Refusal (`400`, `invalid_request`) | When |
| --- | --- |
| `scope_kind must be global or space` | `scope_kind` is missing or neither |
| `a space scope names data_scope_id and space_key` | a space scope lacks one of them |
| `a global scope names no space and no project` | a global scope names one |
| `volumes read the store this service writes; <KEY> lives in an attached store` | the space is in an attached store |
| `no planning space <KEY>` | the store holds no such space, or the `data_scope_id` is no store this service knows |
| `no project <id>` | neither the projects registry nor any item of the store names the project |
| `kind filters tasks: task, bug or improvement` | a `kind` that is no kind of a task, `goal` and `stage` among them |
| `no work item carries label <label>` | a `label` no item of the store carries; a label the store holds but the scope does not gives an empty answer instead |
| the period's refusals of [What agent work spent in a period](#what-agent-work-spent-in-a-period), in its words: `from must be a date or a time with its offset` (and the same of `to`), `to must be later than from`, `from and to must lie between 1970 and 9999, …`, `the period holds more than 2400 steps of one day`, `utc_offset must be from -840 to 840 minutes` | the period |
| `utc_offset must be a whole number of minutes`, `<name> is required`, `<name> must occur at most once`, `<name> is not a parameter` | a parameter missing, repeated or not one of these |

#### A goal's row

A row says what a goal or a stage took over all its time, whatever the period. The
`goals` of the Volumes read holds one for each goal, with the rows of the stages under
it in `children`, in number order; `GET /api/planning/goal-volumes` gives the rows of
the goals and stages it names, without `children`, in the order named.

```json
{"work_item_id": "6f1c2a8e-0000-4000-8000-000000000007", "reference": "MAIN-7",
 "title": "Ship the importer", "kind": "goal",
 "state": null, "container_state": "in_progress", "open": true, "parent_reference": null,
 "other_space": null, "partial": false,
 "tasks": {"total": 120, "closed": 78, "completed": 74, "cancelled": 4,
           "by_category": {"triage": 6, "deferred": 2, "ready": 20, "active": 5, "review": 7,
                           "completed": 74, "blocked": 2, "cancelled": 4}},
 "baseline": {"tasks": 70, "basis": "accepted", "taken_at": "2030-01-05T09:00:00Z"},
 "baseline_absent": null,
 "spent": {"agent_seconds": 79200.0,
           "tokens": {"input": 120000, "cached_read": 9000000, "cache_write_5m": 300000,
                      "cache_write_1h": null, "output": 410000, "reasoning": null},
           "estimated_api_cost_usd": 412.5, "unpriced_tokens": 0, "quality": "mixed",
           "partly_measured": 0},
 "spent_with_cancelled": {"agent_seconds": 81000.0, "…": "the same figures"},
 "sessions": 61, "commits": 140, "commits_unknown_repository": 3,
 "children": [{"…": "the row of each stage directly under it"}]}
```

| Field | What it holds |
| --- | --- |
| `kind` | `goal`, or `stage` for one under a parent |
| `state`, `container_state` | where it stands, as a record says it: `state` a public state, or `null` for an accepted open goal or stage, whose `container_state` is what it derives (see [The work model](#the-work-model)) |
| `open` | whether it stands in neither completed nor cancelled |
| `parent_reference` | the goal or stage it is filed under, or `null` |
| `other_space` | `{key, name}` of the goal's space when that is not the space read; `null` for the space's own goals, in a `global` read and in `goal-volumes` |
| `partial` | some of the items under it are outside the scope, which adds up only the rest |
| `tasks` | its tasks (`task`, `bug`, `improvement`) under it now, at any depth and in any state, that the scope holds: `total`, `closed` of them, `completed` and `cancelled`, and `by_category`, the eight categories, every one |
| `baseline` | how many tasks stood under it when it was accepted: `tasks`, `basis` and `taken_at`; or `null` |
| `baseline_absent` | why `baseline` is `null`, or `null` when it is given |
| `spent` | what its items spent, leaving out every item that stands cancelled now |
| `spent_with_cancelled` | what all its items spent |
| `sessions` | the sessions that spent on any of its items or made a confirmed write to one, each once |
| `commits` | the commits of a known repository attached to any of its items, each once |
| `commits_unknown_repository` | the records of commits of no known repository attached to its items: records, not commits |

The items of a goal are the items under it now, at any depth, with the goal itself.
An item moved out of it, or filed under another goal, leaves with what it spent; a move
between its own stages changes nothing of the goal. A goal's spending leaves out the
items that were cancelled; the sum with them stands beside it. An item cancelled takes
only its own work out of `spent`, and the items under it count by where each stands: a
stage cancelled takes its work and its cancelled tasks out, and a task done under it
stays. For each of the two numbers, a row is its own work, the rows of its stages and
the work of the tasks directly under it, and `spent_with_cancelled` of a goal read
whole is what [How much work an item took](#how-much-work-an-item-took) gives for it
with scope `tree`.

Each number holds `agent_seconds`, `tokens` by kind, `estimated_api_cost_usd` and
`unpriced_tokens` as an item's usage holds them, with `quality` and `partly_measured` of
the items it adds up. Time is agent time, the sum of the stretches: it adds up from
tasks to goals; the union a card's line shows does not. `partly_measured` counts the
tasks it adds up that started before `measured_from`, or were created before it when
they never started: each may have spent more than its usage says.

`tasks` counts the cancelled tasks too: `cancelled` is how many there are. A task moved
out of the goal is not among them, wherever it went.

`baseline` is the count of the tasks under the goal or stage, at any depth and in any
state, when it was accepted (`basis` `accepted`). One accepted with no task under it
takes the count when the first task under it starts (`basis` `started`): a plan of
nothing says nothing. Entering triage or deferred takes the acceptance away and the
count with it; accepted again, it is counted anew. Without a count, `baseline_absent`
says why, the first of these that holds:

| `baseline_absent` | When |
| --- | --- |
| `partial` | the row is `partial`: the count is of all its tasks, `tasks` only of the scope's |
| `not_accepted` | it is not accepted: it stands in triage or deferred, or was closed from there |
| `migrated` | it was accepted before the work model, which kept no count of what stood under it then |
| `not_started` | it was accepted with no task under it, and none under it has started yet |

`sessions` counts the sessions of [How much work an item took](#how-much-work-an-item-took)
over all its items at once: a session that worked on two of them is one session, so a
row's number is not the sum of its tasks' and stages'. `commits` counts the commits
attached now, a commit a rewrite replaced not among them, the way an item's read lists
them; a commit attached to two of its items is one. A commit of no known repository
keeps its hash as it was written, abbreviated too, so one commit may stand as two
records: those are counted apart, as records.

A space's read adds up what its scope holds of each goal. A goal of the space is all
its own work there, unless a project narrows the read; a goal of another space comes
into it through the tasks that name one of the space's projects, and only they and
the goals and stages over them are added up. A row with anything else under it is
`partial`.

`goal-volumes` takes `id`, a reference or a work item id, from 1 to 100 times, and reads
each goal or stage whole: its row is never `partial` and names no `other_space`. It
answers `interface_version` `valkama-planning-api` and `goals`.

| Refusal | When |
| --- | --- |
| `400` `invalid_request`: `id takes 1 to 100 goals or stages` | no `id`, or more than 100 |
| `400` `invalid_request`: `<REF> is a task: goal volumes read goals and stages` | an `id` names a task |
| `404` `not_found`: `no work item <id>` | an `id` names no item |

#### The flow

`flow` says how work moved through the scope on each day of the period, a day of the
caller's clock at `utc_offset`. `days` holds every day the period touches, oldest first,
the quiet ones too, and `totals` adds them up.

| Field | What a day counts |
| --- | --- |
| `created` | the scope's tasks created that day |
| `closed` | the scope's tasks whose present entry into completed or cancelled fell on that day: a task reopened and closed again counts on the later day |
| `decisions` | the owner's decisions: requests of the scope's items answered or declined that day by a call from the interface. The latest call that answered, changed or declined a request says whose it is, so an agent's answer is no decision, and an answer changed later is still one decision, on the day of its latest change |
| `commits` | the commits of a known repository made that day, by the committer time Git gave or, without one, when Valkama learned of the commit, that are attached now to an item of the scope or stand on no card of its projects; each commit once |

Only tasks are created and closed here: making or closing a goal or a stage is not work
flowing. The projects whose commits on no card a scope holds are the project read, the
projects the registry binds to the space read, or, in a `global` read, every known
repository. A commit of no known repository is left out: its hash is kept as it was
written, so one commit may stand as two records.

`pace` reads the scope's tasks as [Reading a chain of work](#reading-a-chain-of-work)
reads a chain's members, with a day of the caller's clock in place of a UTC day: `open`,
how many stand open now; `recent`, the last 7 days up to today, whatever the period; and
`series`, each day with a change since the first. With `utc_offset` `0`, the pace of a
scope that holds one goal's tasks and nothing else is what the chain of that goal gives
in scope `tree`.

#### Filtering by kind and label

`kind` and `label` keep the scope's tasks that match, by the rules of the board's
filter, so a number under a filter opens the board on the same tasks with the same
filter: a task matches when its kind is any of the kinds named, or any kind when none
is, and when it carries every label named. Both together keep what both keep:
`kind=bug&kind=task&label=ui` keeps the bugs and the tasks labelled `ui`. A goal or a
stage never matches: it has no kind of a task, and its labels are not labels of work.

| Part | Under a filter |
| --- | --- |
| `counts.categories` | `tasks` counts the tasks that match and `oldest` is the one of them that came to stand there first; `goals` and `stages` are `null`, not `0` |
| `counts.waiting_owner` | the questions to the owner on the tasks that match |
| `counts.unattached_commits` | as without a filter: a commit on no card has no task whose kind and labels could match, and the number opens the list a commit is attached from |
| `outside` | the tasks that match with no parent; with a `label` named, `by_label` holds the rows of the labels named alone, since a row of another label would only show where it meets the filter |
| `flow` | `created`, `closed` and `pace` read the tasks that match, `decisions` their requests and `commits` the commits attached to them; no commit on no card is counted |

### How often each analytics surface is opened

The Analytics module counts, on this machine, how often each of its surfaces is opened
and how often a task is opened from one, so that the owner can tell the surfaces that
are used from the ones nobody opens. A count is kept per day and kind and holds nothing
else: no text, no item, no session and no time finer than the day. Nothing is sent
anywhere. The kinds are a closed list:

| Kind | Counts |
| --- | --- |
| `page_open` | an opening of the Analytics page |
| `panel_open` | an opening of an analytics panel |
| `mini_open` | an opening of a miniature analytics view |
| `task_open` | a task opened from any of those |

`POST /api/analytics/uses` counts one use, under the rules of every write from the page
([local HTTP security](guides/http-security.md#browser-writes-and-the-installation-token)): an allowed `Origin`
(`origin_refused`, 403), `Sec-Fetch-Site: same-origin` (`fetch_metadata_refused`, 403)
and the page's session credential in `X-Valkama-Session` (401 without it), with a JSON
object for a body:

```json
{"kind": "page_open", "utc_offset": 180}
```

`utc_offset` is the caller's offset from UTC in minutes, from `-840` to `840`, as the
usage read takes it, and is required: the use is counted on the day it is then at that
offset. A body with another field or without one of these, a kind outside the list, or
an offset that is not a whole number in that range is refused with `400` and
`{"error": {"code": "invalid_request", "message": …}}`, and counts nothing. The answer is
the day's count of that kind, the use included:

```json
{"interface_version": "valkama-analytics-api",
 "use": {"day": "2030-03-04", "kind": "page_open", "count": 3}}
```

`GET /api/analytics/uses?from=2030-03-01&to=2030-03-08` reads the counts back. It is
answered as the usage read is, to the page and to a local tool alike, and writes
nothing. `from` and `to` are required
dates, the days as the callers counted them; `to` is not included and must be later
than `from`. Any other parameter, a repeated one or a value that is not a date is
refused as above.

```json
{"interface_version": "valkama-analytics-api",
 "uses": {"from": "2030-03-01", "to": "2030-03-08",
          "total": {"page_open": 3, "panel_open": 0, "mini_open": 0, "task_open": 1},
          "days": [{"day": "2030-03-04",
                    "counts": {"page_open": 3, "panel_open": 0, "mini_open": 0,
                               "task_open": 1}}]}}
```

`total` names every kind, `0` for one not counted in the period; `days` lists each day
with a count, oldest first, with every kind. No MCP tool counts or reads uses.

### Subscription quota samples and accounts

Analytics will read the subscription quota from samples the store keeps, beside the
usage rows and apart from them. This is what a sample and an account hold, what writes
them, and how a usage segment is given its seat. `GET /api/analytics/quota` reads them
under `valkama-analytics-api` and keeps this section's rules
([Each account's subscription quota](#each-accounts-subscription-quota)); no MCP tool
reads them.

A sample is one reading of one window of one account. It holds:

| Field | What it holds |
| --- | --- |
| `at` | when the source read it, UTC to the millisecond: `2030-03-04T09:00:00.000Z` |
| `source` | `statusline`, the Claude Code status line command; `mod`, the Claude Code mod; `poll`, the poll of the usage endpoint; `import`, history imported from a file |
| `organization` | the organization's id, for `poll` and `import` |
| `session_id` | the session the reading came through, for `statusline` and `mod`. Its organization is not written: it is read when the sample is read, from the session's usage rows at `at` |
| `account_uuid` | the account's UUID, where the source gave it: the poll, and imported history that carries it. `null` otherwise, and always for `statusline` and `mod`, whose readings name no account; such a sample's account is read from its seat |
| `seat` | `week:` and the week's reset to the nearest ten minutes, `week:2030-03-08T09:00Z`; `null` when the reading showed no week, or imported history named none. It tells the seats of one organization apart within one week. A sample without a seat belongs to no seat's series, and a forecast does not read it |
| `kind` | the window: `five_hour`, `week`, `week_model` (the week of one model), `extra_usage` (usage credits past the plan's limits) or `spend_limit` (a gateway's spend limit) |
| `model` | the model of a `week_model` window as the source names it; `null` for every other kind |
| `percent` | the share of the window spent, from 0; above 100 only where the source reports an overrun. Required except for `extra_usage` |
| `resets_at` | when the window resets, as `at` is written; `null` when the source did not say |
| `amount`, `currency` | money spent, for `extra_usage` and `spend_limit` only. A currency the source did not state is `null`: not recorded, never assumed |

Every source names its windows its own way, and each name is one kind here:

| Source | Its window | Kind |
| --- | --- | --- |
| `statusline` | `rate_limits.five_hour`, `rate_limits.seven_day`, `rate_limits.spend_limit` | `five_hour`, `week`, `spend_limit` |
| `mod` | `five_hour`, `seven_day` | `five_hour`, `week` |
| `poll` | `limits[].kind` `session`, `weekly_all`, `weekly_scoped` (its model apart); the older buckets `five_hour`, `seven_day`; `spend` | `five_hour`, `week`, `week_model`; `five_hour`, `week`; `extra_usage` |

Every source writes through one function, `server.quota.samples.record`, with a reading:
its source, its time, its windows, its seat, its organization or its session, and the
account's UUID when an organization's source knows it. A
source that sees the week passes the seat `samples.seat_of` gives for its windows; the
seat is never filled in for it. A window is kept only when it differs, in its percent,
reset, amount or currency, from the latest sample of its series at or before the
reading. The series is the organization or the session, the account's UUID, the seat, the
kind and the model, whatever the source. So a gap between two samples means the value did not
change, a reading given twice keeps nothing the second time, and history imported
again adds nothing. A sample is never rewritten. Samples older than a year are deleted
when a server starts.

An account is an organization and the account's UUID in it. Its row holds the plan a
source named, and nothing else of a profile: no e-mail address and no name. A reading that
names an organization and an account's UUID makes the row if it is not there yet, and a
plan it names replaces the one there; a plan comes only with the UUID. The UUID does not
change when a week resets, so the row and whatever is kept against the account hold from
week to week. The name the owner gives an account is kept apart, by its organization
([The owner's names for accounts](#the-owners-names-for-accounts)), and no source writes it.

A seat key comes from the week's reset, so it changes every week, and two seats whose
weeks reset within the same ten minutes cannot be told apart by it and share one key. A
sample without an account's UUID belongs to the account whose samples in the same
organization name the same seat: a key names one week's reset, so the same key is the same
week. A seat no sample with a UUID names, or that samples of two accounts name, is
provisional: it is known for its week and its account is not. Without a source that gives
the UUID, seats are told apart only within a week.

A usage segment holds its organization and no seat, because a change of seat leaves no
trace in a transcript. Its seat is read from the samples, and a sample that arrives
later rewrites nothing. Samples are kept only when a value changes, so a quiet stretch
has none and the last sample still says where things stand: the seat is a state, not the
sample nearest in time.

1. A feed is the samples with a seat that one identity made of one window: one session,
   or the organization's poll and imports, and one kind with its model. A feed's latest
   sample at or before a moment is its state then. The state holds until that sample's
   window resets, or the week its seat names ends when that comes first; the next sample
   of the feed replaces it.
2. The feeds whose latest sample at or before the segment's end still holds at the
   segment's start count, and of them the most recent sample names the seat. A sample
   after the segment's end does not.
3. The feeds of the segment's own session come first, and a session's feed counts only
   while that session was working for the segment's organization at its latest sample's
   time.
4. Without one, the feeds of the organization count: its poll's and imports', and another
   session's while that session was working for it.
5. With none, the seat is unknown. A segment with no organization is on a seat unknown too.
6. The account is the naming sample's UUID, or else the one the seat belongs to by the
   rule above; a provisional seat has none.

The read says which rule named the seat: `session` or `organization`, with that sample's
time, and the account's UUID or none for a provisional seat.

Percentages and money never share a figure. No answer carries a sum of percentages: a
percentage belongs to one account and one window, and the percentages of different
accounts are never added. Money stays with its window and is never added to the API-price
estimate of the usage reads.

`valkama quota import --source FILE` imports history from a file of JSON lines, one
sample a line:

```json
{"organization": "6f1c2a8e-0000-4000-8000-000000000001", "at": "2030-03-04T09:00:00Z",
 "kind": "week", "percent": 42, "resets_at": "2030-03-08T09:00:00Z",
 "seat": "week:2030-03-08T09:00Z", "account_uuid": "0b7d4e19-0000-4000-8000-000000000002"}
```

`organization`, `at` and `kind` are required, and the other fields of a sample may be
left out. Each line is kept through the same function, as the `import` source, oldest
first, in one transaction. A line's seat and account's UUID are kept as the line gives
them and never derived from its reset. Any other field, a line that is not such an object, or a value a sample
cannot hold refuses the whole file, naming the line, and writes nothing. The command
prints the lines read, how many were added, how many matched the sample before them
(`unchanged`) or were older than a year (`expired`), and each organization's first and
last time.

### Each account's subscription quota

`GET /api/analytics/quota` answers, under `interface_version` `valkama-analytics-api`,
where every account's quota windows stand now, from the samples above. It is answered as
the usage read is, to the page and to a local tool alike, and writes nothing. A later
build only adds fields, kinds and sources to this answer. No MCP tool reads it.

Its one parameter is `utc_offset`, the caller's offset from UTC in minutes, from `-840`
to `840`, `0` by default, at which every time in the answer is written. Any other
parameter, a repeated one or an offset out of its range is refused with `400` and
`{"error": {"code": "invalid_request", "message": …}}`, as the usage read refuses it. An
empty store answers with no account. A sample or a stretch of work dated after `now`, as a
source whose clock runs ahead could write, is left out until `now` reaches it.

```json
{"interface_version": "valkama-analytics-api",
 "quota": {
   "now": "2030-03-06T13:00:00.000+03:00", "utc_offset": 180, "fresh_for_seconds": 900,
   "accounts": [
     {"organization": "org-a", "account_uuid": "acct-a", "seat": null, "plan": "Max",
      "name": null, "no_source": false,
      "windows": [
        {"kind": "five_hour", "model": null, "state": "fresh",
         "resets_at": "2030-03-06T16:00:00.000+03:00",
         "latest": {"at": "2030-03-06T12:55:00.000+03:00", "source": "poll",
                    "used_percent": 50.0},
         "started_at": "2030-03-06T11:00:00.000+03:00", "even_percent": 40.0,
         "readings": [{"at": "2030-03-06T12:00:00.000+03:00", "used_percent": 20.0,
                       "source": "poll"},
                      {"at": "2030-03-06T12:55:00.000+03:00", "used_percent": 50.0,
                       "source": "poll"}],
         "forecast": {"outcome": "runs_out",
                      "runs_out_at": "2030-03-06T13:40:00.000+03:00", "basis": "blend"}},
        {"kind": "week", "model": null, "state": "fresh",
         "resets_at": "2030-03-08T12:00:00.000+03:00",
         "latest": {"…": "as above", "used_percent": 41.0},
         "started_at": "2030-03-01T12:00:00.000+03:00", "even_percent": 72.02,
         "readings": ["…"],
         "forecast": {"low_percent": 56.93, "high_percent": 61.2}}]},
     {"organization": "org-b", "account_uuid": null, "seat": null, "plan": null,
      "name": null, "no_source": true, "windows": []},
     {"organization": "org-c", "account_uuid": null, "seat": "week:2030-03-08T09:00Z",
      "plan": null, "name": null, "no_source": false,
      "windows": [
        {"kind": "spend_limit", "model": null, "state": "silent", "resets_at": null,
         "latest": {"at": "2030-03-06T12:00:00.000+03:00", "source": "statusline"}}]}]}}
```

| Field | What it holds |
| --- | --- |
| `now` | the moment the answer was worked out; every pace and state is as of it |
| `fresh_for_seconds` | how old a window's latest sample may be and still be fresh: 900, the span the quota alerts read too |
| `accounts` | one entry per account with a sample in the last seven days, and one per organization with a usage segment in that span and no such sample. A provisional seat whose week has ended is left out, and its organization is not then an entry with no source. Ordered by organization, then account |
| `organization` | the organization's id |
| `account_uuid` | the account's UUID: the sample's own, or the one its seat belongs to by the rule above; `null` for a provisional seat and for an organization with no sample |
| `seat` | the provisional seat the samples without a UUID are on, `null` when the UUID is known. A provisional seat is known for one week, so once its week has ended it is no entry: the same machine read across a reset is the next week's seat alone, not two accounts |
| `plan` | the plan a source named for the account, or `null` |
| `name` | the name the owner gave the account's organization, as the next section says, or `null` when none is set. Every entry of one organization has its name |
| `no_source` | `true` for an organization whose work no quota source has read in the seven days; its `windows` are empty. An account with samples is `false` |
| `windows` | the account's windows, in the kinds' order above, a model's week by model: one per `kind` and `model` its samples have |

A window that is a share of a limit, `five_hour`, `week` or `week_model`, holds:

| Field | What it holds |
| --- | --- |
| `kind`, `model` | the window, as a sample names it |
| `state` | `fresh` while its latest sample is at most `fresh_for_seconds` old, `silent` once it is older. Samples are kept only when a value changed, so a silent window has not moved since; it does not say the source stopped. A fresh `0.0` is a value, not a missing one |
| `latest` | the window's latest sample: `at`, `source` (`statusline`, `mod`, `poll` or `import`) and `used_percent`, the share of the window it said was spent |
| `resets_at` | when the window resets, as its latest sample said; `null` when the window has not started |
| `started_at` | its reset less its length, five hours or seven days; `null` without a reset |
| `even_percent` | how much of the window steady use from its start would have spent by `now`: the pace tick. `null` without a reset or once the reset has passed |
| `readings` | its samples since `started_at` that name this reset, oldest first, each with `at`, `used_percent` and `source`, for a step line. The samples of every source of the account are in it, so one source's reading can be lower than another's before it |
| `forecast` | `null` while the window has too little history or its reset has passed. The five-hour window gives its point answer: `outcome` `lasts`, `runs_out` with `runs_out_at`, or `spent`, and `basis`, the pace it read (`recent`, `blend` or `window`; `null` when spent). A week, and a model's week, give only a range: `low_percent` and `high_percent`, the share of the week the slower and the faster of its paces would have spent by the reset, above 100 when the week runs out first. A week never has a point forecast here |

A window of `extra_usage` or `spend_limit` is its own kind and holds `kind`, `model`,
`state`, `resets_at` and `latest` with `at` and `source` alone: no percent, no amount
and no forecast. The answer holds no money.

No field is a sum or a total of percentages. A percentage belongs to one window of one
account: the windows of an account are not added, and neither are two accounts'
percentages, of one organization or of two. A reading whose organization is not known
yet, because the session's transcript has not been read that far, or that names neither
an account's UUID nor a seat, belongs to no account and is not in the answer.

### The owner's names for accounts

The usage rows and the quota samples hold an account's organization id and nothing that
names it, so the owner names it, and Valkama keeps one name per organization in the store's
`quota_account_names` table: `organization`, `name` and `updated_at`, the UTC time of the
write to the millisecond. An organization with no name has no row. Settings writes the
name; the Analytics page on every device and the quota alerts read it, and the store's
snapshots and restore carry it with the other quota tables. Other server modules read it
through `server.quota.names.names_of(conn, organizations)`, which answers the names of any
number of organizations in one query, by organization, leaving out one with none.

| Route | What it does |
| --- | --- |
| `GET /api/quota/account-names` | every name: `{"names": {"<organization>": "<name>"}}`, `{"names": {}}` until one is given |
| `PUT /api/quota/account-names` | `{"names": {"<organization>": "<name>"}, "replace": true}` names each account given, or with an empty name takes its name away, in one transaction, and answers every name then stored in the read's shape. `replace` may be left out and is `true`; with `false` a name is stored only for an organization that has none, and an empty one changes nothing |

A name is one line: its runs of spaces and line breaks are collapsed to one space and its
ends trimmed, and what is left is at most 80 characters, counted as characters rather
than UTF-16 units, with no control character. An organization is 1 to 512 characters with
no NUL. A write that breaks either rule, names more than 1000 accounts, or carries a field
other than `names` and `replace` is refused whole with `400`,
`{"error": {"code": "invalid_request", "message": "<why>"}}`, and changes nothing. The read
answers under the `Host` rule alone; the write takes the browser's credential, as the
quota settings do.

A device that kept names of its own, as builds before this one did in the settings each
browser and the desktop app keep, writes them once with `"replace": false` the first time
it opens Settings or Analytics, so a name given since on another device stays, and drops
them once the write succeeded. A write that failed leaves them for the next open.

A quota alert names the account by its organization's name where there is one, before the
share spent, and says no name where there is none, nor where the owner chose notifications
whose text reveals nothing of the work.

### The poll of the usage endpoint

The `poll` source asks the usage endpoint Claude Code's `/usage` reads, for the account
Claude Code is signed in to on this machine. It is off on a clean install and runs only
after the owner of the installation switches it on in Settings: the endpoint is
undocumented, and Anthropic's terms do not explicitly permit this use of it. Only the
listener runs it, and switching it on or off there takes effect at once, with no restart.

| Route | What it does |
| --- | --- |
| `GET /api/quota/settings` | the owner's quota settings: `{"poll": false}` until switched on |
| `PUT /api/quota/settings` | replaces them and starts or stops the poll in the listener; an unknown key is refused and a missing one takes its default |

The read answers under the `Host` rule alone; the write takes the browser's credential,
as the notification settings do.

- **The sign-in.** The token is read from Claude Code's `.credentials.json` in its home
  (`CLAUDE_CONFIG_DIR`, else `~/.claude`) for each request and held only for that
  request. It is sent in one header to `api.anthropic.com` over HTTPS, no redirect is
  followed, and it is written nowhere: not to the store, a log, the doctor's answer or an
  error's text. The poll never refreshes a sign-in. The Claude desktop app's sign-in is
  not read.
- **What is kept.** A reading is recorded as the `poll` source, by the organization the
  profile names, with the account's UUID and the plan. The profile's e-mail address and
  name are never read out of the answer.
- **The pace.** Five minutes while a usage segment of the organization ended in the last
  ten minutes, fifteen otherwise, each lengthened by up to a tenth at random. After a 429,
  ten minutes, doubled for each one in a row up to thirty, or the server's `Retry-After`
  when that is longer; after any other failure the same from one minute. A sign-in that
  was refused (401 or 403), has expired, or is missing is looked at again each minute,
  and a refused one is tried again only once the file has changed.
- **Beside the session readings.** While a `statusline` or `mod` reading of a session of
  the organization is under ten minutes old, the poll waits out the fifteen minutes from
  its last request.

`valkama doctor` reports the poll under Capabilities as `quota-poll`: off, working,
paused after a 429, sign-in refused (a 401 or 403, or an expired sign-in), no sign-in, a
failing endpoint, or switched on with no listener polling, each with what to do. It reads
the setting from the store and the poll's state from `<store>.quota-poll.json`, which the
listener writes and which names no account.

### The space's stream

`GET /api/planning` answers a space's whole read model, and
`GET /api/events?view=planning` sends it again as an unnamed event each time it
changes. Both carry `revision` first: the SHA-256, in hex, of the model's compact JSON
without it. Two reads that answer the same model carry the same revision, and any
difference in what the model says, an item, a link or `live_work`, changes it. Each
frame of the stream also names it as its event `id`.

The page reads the space and only then opens its stream, with that read's revision as
`since`. When the model still has that revision, sending it would repeat the read, so
the stream sends this short event in its place, and its first frame is the next change:

```text
id: 3f9c…
event: current
data: 3f9c…
```

A change that landed between the read and the stream gives the model another revision,
and that model is the stream's first frame. `since` is taken once, not empty, and only
with `view=planning`; any other use of it is refused with 400.

A browser that lost the stream reconnects to the same address by itself and sends the
last event's `id` as `Last-Event-ID`. A request that carries that header is sent the
model whatever `since` says: the page may by then hold a model newer than the read the
address names, and it takes the first frame after a dropped connection as news even
when that frame says what the page has.

### The live-work frame

One small read says where work is going on now, across every space of the primary
store. The interface's side panel draws it, and the picker of
[mentions](#mentions) offers its rows first. It reads every open item and every
[pinned](#pins) one in one query and gives each the state a graph moves by
(`working`, `held`, `waiting` or `quiet`). Beside the items it lists the sessions
that work or wait on none of them. It carries no history and no time that moves, so
it changes only when a state does: with a write to the store, with a client writing its
transcript or falling silent, and with a session's title. Attached stores are not read.

```json
{"spaces": [{"key": "MAIN", "name": "Main",
   "projects": [{"project_id": "example-project", "display_name": "Example project"}],
   "default_project": "example-project",
   "rows": [
     {"reference": "MAIN-4", "title": "Structured answers", "kind": "goal", "parent": null,
      "state": null, "agents": 0, "long": false, "asks": false, "since": null,
      "quiet_since": null, "executor": null, "pinned": false, "state_name": "",
      "is_terminal": false, "open": true, "container_state": "in_progress",
      "updated_at": "2026-10-28T08:00:00Z"},
     {"reference": "MAIN-12", "title": "Answer a review in one form", "kind": "task",
      "parent": "MAIN-4", "state": "working", "agents": 2, "long": false, "asks": false,
      "since": "2026-11-04T10:08:12Z", "quiet_since": null,
      "executor": {"session": "6f1c2a8e-0000-4000-8000-000000000002", "agent": null,
                   "opened_in": "ide", "opened_host": "vscode", "family": "claude",
                   "state": "live"},
      "pinned": false, "state_name": "Dev", "is_terminal": false,
      "open": true, "container_state": null,
      "updated_at": "2026-11-04T10:15:00Z"},
     {"reference": "MAIN-15", "title": "Read the answers back", "kind": "task",
      "parent": "MAIN-4", "state": "waiting", "agents": 0, "long": false, "asks": true,
      "since": "2026-11-04T10:11:30Z", "quiet_since": null,
      "executor": {"session": "6f1c2a8e-0000-4000-8000-000000000003", "agent": null,
                   "opened_in": "terminal", "opened_host": "", "family": "claude",
                   "state": "live"},
      "pinned": false, "state_name": "Dev", "is_terminal": false,
      "open": true, "container_state": null,
      "updated_at": "2026-11-04T10:05:00Z"},
     {"reference": "MAIN-13", "title": "Tell other work", "kind": "task",
      "parent": "MAIN-4", "state": "quiet", "agents": 0, "long": false, "asks": false,
      "since": null, "quiet_since": "2026-11-03T18:02:11Z",
      "executor": {"session": "6f1c2a8e-0000-4000-8000-000000000004", "agent": null,
                   "opened_in": "", "opened_host": "", "family": "claude",
                   "state": "live"},
      "pinned": false, "state_name": "Dev", "is_terminal": false,
      "open": true, "container_state": null,
      "updated_at": "2026-11-03T17:40:00Z"},
     {"reference": "MAIN-7", "title": "Old migration", "kind": "task", "parent": null,
      "state": null, "agents": 0, "long": false, "asks": false, "since": null,
      "quiet_since": null, "executor": null, "pinned": true, "state_name": "Done",
      "is_terminal": true, "open": false, "container_state": null,
      "updated_at": "2026-10-02T12:00:00Z"}],
   "sessions": [
     {"session": "6f1c2a8e-0000-4000-8000-000000000001", "title": "Compare two exports",
      "folder": "example-project", "state": "working", "long": false, "asks": false,
      "agents": 1, "since": "2026-11-04T10:02:40Z",
      "executor": {"session": "6f1c2a8e-0000-4000-8000-000000000001", "agent": null,
                   "opened_in": "ide", "opened_host": "vscode", "family": "claude",
                   "state": "live"}}]}],
 "elsewhere": []}
```

| Field | What it holds |
| --- | --- |
| `key`, `name` | the space |
| `projects` | the projects the registry binds to the space, each with its `project_id` and `display_name`, the default one first and the others by id; empty when none is bound, and `null` when the registry could not be read |
| `default_project` | the `project_id` of the space's default project, `null` when no project is bound or the registry could not be read |
| `rows` | the space's rows, in the order they are drawn |
| `sessions` | the sessions under this space that work or wait on no row, freshest first |
| `elsewhere` | the same list for sessions whose folder lies under no space |
| `reference`, `title`, `kind` | the item |
| `parent` | the reference of the item's parent, which is then a row of the same space, or `null` |
| `state` | the live state: `working`, `held`, `waiting`, `quiet`, or `null` for a row with no live work |
| `agents` | the live subagents placed on this item, by the order usage counts by (see [How much work an item took](#how-much-work-an-item-took)), each on one item; a session's own run is not counted, since `state` already says it |
| `long` | for a `waiting` row, whether its session has been silent for more than 4 hours; `false` for any other row. It turns once and is no time |
| `asks` | for a `waiting` row, whether its session stopped in the middle of a turn to ask a person, for a permission or an answer, rather than ended its turn; `false` for any other row |
| `since` | for a `waiting` or a `working` row a session stands behind, when that session began what it is doing now: its last prompt or notice while its turn is open, or the end of its last turn. Only the session's own lifecycle events move it. `null` for any other row |
| `quiet_since` | for a `quiet` row, when its session last gave a sign of life; `null` otherwise. It does not move while the row stays quiet |
| `executor` | the session the row's state comes from, as a holder is read (see [Who holds a claim or a step](#who-holds-a-claim-or-a-step)), so a client can open that session from the row; `null` for a row with no live work and for one only an attempt Valkama runs moves |
| `pinned` | whether a person pinned the item |
| `state_name`, `is_terminal` | the item's workflow state, as a link names the state of its other end; an accepted open goal or stage has an empty `state_name` |
| `open`, `container_state` | as an item record has them (see [The work model](#the-work-model)) |
| `updated_at` | when the item last changed, as its card says it. Only a write to the item moves it, so a frame read again over an unchanged store keeps it |

A session of `sessions` or `elsewhere`:

| Field | What it holds |
| --- | --- |
| `session` | the session's id, which a click opens (see [What a click opens](#what-a-click-opens)) |
| `title` | the name its client shows for it, or `null` when there is none to read |
| `folder` | the last part of the folder that places it (see below), or empty |
| `state` | `working` while a turn of its own runs or it has a live subagent, else `waiting` |
| `long` | for a `waiting` session, whether it has been silent for more than 4 hours |
| `asks` | for a `waiting` session, whether it stopped in the middle of a turn to ask a person |
| `agents` | how many live subagents it has |
| `since` | when what it is doing now began: its last prompt or notice while its turn is open, else the end of its last turn. Only the session's own lifecycle events move it |
| `executor` | where the session is open and whose settings cover it, as a holder has (see [Who holds a claim or a step](#who-holds-a-claim-or-a-step)) |

**Which rows.** An open item whose state is `working`, `held`, `waiting` or
`quiet`; a pinned item, open or closed, whatever its state; and every parent of
those, so that `parent` always names a row. A `quiet` row is one whose session has
been silent for more than a day; it is shown, muted, so a claim nobody works on is
seen. Each item is one row, so a goal or stage is its group's heading with its
own state. A space with no rows and no sessions is not in the
frame.

**Which sessions.** A session that is active, was heard from within the last day,
is at work or was ever given a prompt, and none of whose work is a row: neither an
item it holds or stands on, nor one a live subagent of it is placed on. A session
that works on an item is seen through that item's row and is not listed twice. One
opened and left with no prompt waits for nobody and is not listed, and one that
ended or fell silent for more than a day leaves the frame.

**A session's title.** Claude Code writes the name it shows for a session into that
session's transcript, and the frame reads it from the end of that file: the name a
person gave, or else the one the client made. It may say what the person asked for,
so it is computed for the frame and kept nowhere: it never enters the store, a log
or a diagnostic. Nothing else of a transcript's content is read for the frame, and
another client's transcript is not read at all, so its sessions have `title: null`.

**Order.** Spaces by key. In a space, a row that is another row's parent is a
group: the groups come first, by the place of their state in its workflow and
then by number, each followed by its own rows, and then the rows with neither a
parent nor rows of their own. A group has no urgency or start of its own in the
queue's sense, and its number is its age. Rows that are not groups stand by number, so a change of state does
not move a row, and a pinned row stands at its number among the others. The frame
is already in order, and a client that lists it as it came does not sort it. The
interface's side panel draws its own order from it: the rows at work, freshest
`updated_at` first; the rest folded or apart (see `DESIGN.md`).

**`sessions` and `elsewhere`.** A session is placed by its first folder that is
not empty: for Claude Code the folder its transcript names, then its
`opened_folder`, then its `cwd`; for Codex its `opened_folder`, then its `cwd`. The
project whose root is the longest one that contains that folder holds it, compared
as the platform compares paths (on Windows without regard to case) and without
following links, and the session's space is the space that project is bound to in
this store. A shorter root does not stand in: a session under a project that binds
no space here is in no space, even inside the root of one that does. Such a
session, and one whose folder lies under no root, is listed in `elsewhere`.
Analytics counts a session's work on no item to the project of the same place (see
[What agent work spent in a period](#what-agent-work-spent-in-a-period)). This
places a row and nothing more: nothing is written, nothing is routed, and no
binding is ever inferred from a folder.

**How it arrives.** There is no route to poll. A stream opened with
`GET /api/events?view=planning`, with or without an exact scope, carries the frame
as an event of its own beside the space's read model, and `view=live` is a stream
that carries only that event:

```text
event: live
data: {"spaces": [...], "elsewhere": []}
```

A stream sends the frame when it opens and again only when the frame differs from
the one it sent last. The frame is read from the primary store, not from the store
of the space the stream follows. It is computed at most once every 2 seconds and at
the stream's 60-second reread; a change that lands sooner is computed when the 2
seconds have passed. `view=live` takes no scope: with one it is refused as any view
other than `planning` is. A page whose space stream is open takes the frame from
that stream, and a page with none opens `view=live`, so a tab holds one stream.

The start is the one exception, and it is bounded. A space stream opens only after
the space has been read, which on a large space takes seconds, so the shell opens
`view=live` as it starts, before it knows what it shows. That stream lives only
until a space stream has delivered its own `live` event, and then closes; the list
is never without a source between the two. When the shell turns out to show a page
with no space stream, the same stream stays open as that page's. The start happens
once per tab: a space stream that drops and reconnects does not open it again.

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

### Subscriptions

**Since 2.6.** An agent session hears what other sessions write on the items it
holds (see the [hook contract](hook-contract.md#another-agent-sessions-news)). A
session that depends on an item it does not hold subscribes to it, and hears that
item's news as a holder would, a person's acts there included, though those wait
for its next tool call and never wake it; it unsubscribes when it no longer needs
the item.
There is no tool of its own: the `subscribe` group of `apply_work_item_changes`
takes a boolean, and `applied.subscribe` says what now stands:

| Sent | The session holds the item | Writes | `applied.subscribe` |
| --- | --- | --- | --- |
| `true` | either way | a subscription | `following` |
| `false` | yes | a mute, while the session holds the item: other sessions' news there is not told, a person's still is, and so are the replies to the session's own `awaits_reply` comment | `muted` |
| `false` | no | nothing, and forgets a subscription | `not_following` |

"The session" is the confirmed session and agent of the call, never `author`: a
subagent's subscription tells that subagent and its orchestrator, and its mute
silences only itself, while an orchestrator's covers what it hears. A call that
proved no session, and the interface, are refused with `invalid_request`. Asking
for what already stands changes nothing. `subscribe` applies right after `claim`,
so a batch that claims an item and sends `false` mutes it.

A subscription is not a change to the item: no history event, no revision, and
nobody is told of it. Its call is recorded, naming the item, as every write's is.
It lapses with its session by the rule a [claim](#claims-are-leases) lapses by:
its session has no row, failed, ended more than 12 hours ago or has not been seen
for 14 days. That silence is a subscription's own and longer than a lease's three
days: a subscription left over costs a row and a name among the subscribers, while
one lost leaves a session deaf to the owner's answer it still waits for. A lapsed subscription or mute reads as gone at once, to the card and
to the hook alike, and [the planning sweep](#the-planning-sweep) that releases
lapsed claims removes it; a session that comes back within its grace finds it standing. A merge
gives the survivor the subscriptions of the items merged into it, keeping the
survivor's own where both have one, and a carried one hears the survivor from the
merge on; a deleted item takes them with it.

Every full record of an item, the HTTP item read and the web card's read alike,
and the `subscribers` part of `get_work_item` list the sessions that follow it
now, oldest first; a mute and a lapsed one are not listed:

```json
"subscribers": [{"session": "019a…", "client": "codex", "agent": null,
                 "label": "codex (session 019a…)", "since": "2026-11-06T09:00:00Z"}]
```

`client` is the client the subscribing call came from, and `agent` the subagent
that subscribed, or `null` for the session's own conversation. `label` is the
holder a claim by that session, or by that subagent, records in `claim_ref`: named
after the channel that proved the session, not after `client`, and with an id too
long for a label replaced by its digest, as a claim's is. So a reader that compares
it with `claim_ref` tells which subscriber holds the item.

A goal an agent creates is followed from the start by the conversation of the
agent's session, `agent` null, even when a subagent created it: the goal outlives
the subagent, and its news is for the conversation leading the work. A stage
subscribes nobody, and a goal the interface creates nobody either. This
subscription, too, writes no event.

### Participants

A goal or a stage also says who works on it: the sessions that are live and that,
themselves or through a subagent, hold the claim or an open step of a task anywhere
under it, or follow it or an item over it. A participant is always a session's own
conversation. Live is one rule for all three: the session has a row, has neither
ended nor failed, and was seen within the 14 days of a claim's lease. An ended
session is no participant from the moment it ended, though its claim stands through
its 12 hours of grace; resumed, it is one again while its claim or subscription
stands. Nothing is stored: every read derives them from the holders and the
subscriptions.

The card's read (`/api/modules/planning/work-item`) and the HTTP read of one item
(`/api/planning/work-item`) carry them on a goal or a stage, and `get_work_item`
reads them as its `participants` part, which the card counts; its card, every
answer of a write and the brief records of a list do not carry them, and a task has
none:

```json
"participants": [{"session": "019a…", "client": "claude-code",
                  "label": "claude (session 019a…)", "holds": ["MAIN-12", "MAIN-15"],
                  "follows": false, "last_seen": "2026-11-16T09:12:03Z"}]
```

`client` is the client the session's row names, and `label` the holder its own
conversation records, as in `subscribers`. `holds` names up to 20 tasks under the
item that the session or its subagents hold, by reference; `follows` says whether
it follows the item or an item over it. They stand in the order of `label`, at
most 50.

### Several changes in one call

`apply_work_item_changes` applies several writes to one item in one call, all or
nothing. It is the one MCP tool that edits an item's fields, sets and ticks its
steps, attaches refs and commits, links it, writes and resolves its discussion, records its
summary and moves its state. It takes `id`, `author`, `expected_revision`,
`verbose` and any of these groups, and applies them in this order:

| Group | Shape | HTTP write of one step |
| --- | --- | --- |
| `claim` | `true`; `false` is no change | `/claim`, as `claim_work_item` |
| `subscribe` | `true` or `false` | [Subscriptions](#subscriptions); only here |
| `update` | `{title?, description?, labels?, labels_add?, labels_remove?, priority?, kind?, parent?, source?, mentions?}` | `/update` |
| `convert` | `{to, leftover?: {title?, steps?}, force?}`; not with `transition`, `defer` or `move_out` | `/convert`, see [Converting a task into a goal or stage](#converting-a-task-into-a-goal-or-stage) |
| `checklist` | the steps' list, or `{items, force?}`; each step text or `{text, done?}` | `/checklist` |
| `checklist_ticks` | list of `{item_id, done?, force?}`, `done` true by default | `/checklist/tick` |
| `refs` | list of `{kind, value, label?}`, `kind` one of `memory`, `session`, `url`; `commit` is refused, naming the `commits` group | `/ref` |
| `commits` | list of `{repository, hash, label?, remove?}` | only here |
| `links` | list of `{other, kind, remove?}`, linking from this item | `/link` |
| `comment` or `comments` | `{body, checklist_item_id?, reply_to?, reply_to_request?, list?, mentions?, awaits_reply?}`, or a list of them | `/comment` |
| `resolutions` | list of `{comment_id, resolution?, reopen?}` | `/comment/resolve` |
| `questions` | list of `{kind, prompt, fields, expires_at?, execution_id?, session_id?, addressees?}` | `/request`, as `create_work_item_request` |
| `summary` | `{done, next, why?, friction?, list?, mentions?}` | `/summary` |
| `transition` | `{state, reason?, force?, acceptance?, to_check?, cancels?}` | `/transition` |
| `defer` | `{until, reason, force?}`; not with `transition`, `move_out` or `convert` | `/defer`, see [Putting work off](#putting-work-off) |
| `move_out` | `{reason, force?}`; not with `transition`, `defer` or `convert` | `/move-out`, see [Moving work out of a goal or stage](#moving-work-out-of-a-goal-or-stage) |

Each path in the last column is under `POST /api/planning/work-item`.

A summary or a report is `done` and `next`, with `why` only when the choice is not
obvious and `friction`, what hindered the work itself: `none` or a line per
hindrance. Each is text of at most 4000 characters, kept apart in every read, so a
closing summary's friction stands on its own line instead of ending its `done`. The
same four keys go to `POST /api/planning/work-item/summary` and
`POST /api/planning/work-item/report`.

Each step is the write its HTTP path makes, with the same guards, events,
revision bumps and refusals, so a closing transition is judged after the ticks
and the summary sent with it. The call is still one write: what its earlier
groups wrote does not count as the agent having read what a person did, so a
`comment` sent beside a closing `transition` does not lift the
[`person_spoke` guard](#a-close-over-what-a-person-did).

`checklist` sets the steps. A step sent
with the text of a step the item has is that step: it keeps its `item_id`, its
claim, its tick and who made them, and its `by_previous_holder`, and duplicate
texts match in order. So steps
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
only by a tick with `done: false`. A tick through `checklist_ticks` or
`/api/planning/work-item/checklist/tick` of a step already done ticks it again:
ticking a step again confirms a tick its lapsed holder made and clears
`by_previous_holder`. A step that names an `id` the item
does not have is one carried over and keeps the state it carries. A list holds
at most 100 entries. At least one
group must name a change, and an entry with a field its group does not take is
refused; both are `invalid_request` before anything is written.
`expected_revision` is checked once, against the item as the call found it.
It belongs to the call: `update` takes none of its own.

`update` edits the item: a field that is absent or
null is left alone, and an edit writes no history event. It is applied after
the claim. `parent` moves the item under another goal or stage; `parent: ""`,
which cleared the parent, is refused with `[parent]`, `invalid_request`, naming
`move_out`: an item leaves its goal or stage only with the reason that group
records. `convert`, `transition`, `defer` and `move_out` each change the state,
and a call that names two of them is refused with `invalid_request` before anything is
written.

`comments` writes up to 100 comments in the order sent, each as `comment`
writes one. The older `comment` group, one comment, still
works; a call that names both is refused with `invalid_request`. A parent named
in `reply_to` must already exist when that entry is written: the id of a
comment the same call writes is not known to the caller, so a reply to it is a
second call. The same holds for `resolutions`.

**Since 3.0.** `commits` attaches commits by hand, or detaches them with
`remove: true`. Valkama attaches the commits a session makes and says so in the
hook answer, as `docs/hook-contract.md` describes; this group places a commit it
could not place, one made outside a session, or one on the wrong item, which
moves by a `remove` there and an attachment on the right one.

- `repository` is a registered project's id. `hash` is a whole hash or its
  start of at least 7 hex digits, in either case.
- An attachment asks the project's root `git rev-parse --verify <hash>^{commit}`
  for the whole hash, and records a commit Valkama did not know with its subject
  and time and no session. On a machine without the project's root a whole hash
  is recorded as it is.
- The attachment is signed `manual`. On a task it adds the commit's project with
  the source `commits`, as
  [The projects an item changes](#the-projects-an-item-changes) says; a goal or
  stage takes the commit and no project.
- A detach names one of the commits attached to the item, by its whole hash or
  a start, and asks no repository. The commit stays, and a session's commit
  attached nowhere else is on no card again. A task loses the commit's project
  when it held it by its commits alone and no other attached commit is of it.
- Each attachment and detachment writes the history event `commit_attached` or
  `commit_detached` with the detail `<repository> <hash>`. An attachment the item
  has already writes nothing.

An entry is refused with `invalid_request`:

| Entry | Refusal |
| --- | --- |
| a project the registry does not record | `[commit] <repository> is not a registered project: <ids>` |
| a hash its repository holds no commit of, or one that is no hash | `[commit] <hash> is not a commit in <repository>` |
| a start of a hash, on a machine without the project's root | `[commit] <repository> has no root on this machine, so the short hash <hash> cannot be resolved: send the full hash` |
| a start that more than one object of the repository begins with | `[commit] <hash> is ambiguous in <repository>: send more digits` |
| `remove` of a commit the item does not have | `[commit] <repository> <hash> is not attached to <REF>` |

`questions` asks up to 100 questions, each with what `create_work_item_request`
takes and checked by the same rules. Without `addressees` each is that tool's
question: it waits in the owner's list and raises the owner's alert once the call
is committed. With `addressees` an entry asks those sessions instead, as that tool
does, one request each, and waits in no owner's list. A call that asks a question
and closes the item with its `transition` is refused, `invalid_request` on the `transition` step, and
`force` does not carry it: the close ends every request still pending on the item in
the same write, so the question would be asked and ended unanswered at once. The
refusal reads `transition: a question on an item this call closes would end
unanswered in the same write: ask it in a call that leaves the item open`. An
agent's call that asks the owner and completes the item meets the
[`question` guard](#review-asks-the-owner) first, `workflow_guard` on the same step.
A question asked by an earlier call does not stop a person's close, nor an agent's
cancellation; the close ends it, as below. A closed item takes no question, and `questions` is applied before
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
`update` lists the fields sent;
`commits` is `{attached, removed, unchanged}`: the `{repository, hash}` of each
commit attached and removed, and how many entries named a commit attached
already;
`comments` and `questions` list every comment and question the call wrote, so
a reply or a withdrawal needs no read first. A question with `addressees` lists its
`requests`, each `request_id` with its `addressee`, in place of `request_id` and
`revision`. A comment or a summary that carried a
[list](#a-list-on-a-comment) adds its `list_request_id`, and a comment or a summary
that named other items adds who will hear them as [`mentions`](#mentions). Who will
hear the items an `update`'s description named stands beside `applied`, as
`mentions`:

```json
{"claim": true, "update": ["title", "priority"],
 "checklist": [{"item_id": "…", "text": "write it", "done": false}],
 "checklist_ticks": [{"item_id": "…", "done": true}], "refs": 1,
 "commits": {"attached": [{"repository": "valkama", "hash": "3f2a9c1…"}], "removed": [],
             "unchanged": 0},
 "links": 1,
 "comments": [{"comment_id": 41, "reply_to": null, "reply_to_request": null}],
 "questions": [{"request_id": "…", "revision": 0}],
 "summary": {"summary_comment_id": 42},
 "transition": {"state": "review", "review_request_id": "…"}}
```

The batch is also the HTTP write `POST /api/planning/work-item/apply`, which
takes the same body and answers with the full item and `applied`. Each HTTP path
of one step stays as it is; the MCP tools that made one step each are gone (see
[Removed tools](#removed-tools)).

**Since 2.5.** The `comment` group takes a parent, and `applied.comment` then
carries `reply_to` and `reply_to_request` beside
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

`create_work_item` (`POST /api/planning/work-items`) takes `kind` as
[The work model](#the-work-model) names it, `acceptance: "assignment"` to accept
the new work on the owner's word, and three optional arguments that act on the
item it creates:

| Argument | Shape | Works as |
| --- | --- | --- |
| `claim` | `true` | `claim_work_item`, refused for a goal or stage; `false` is no change |
| `checklist` | the steps' list or `{items}`, as the batch's group takes it, without `force` | the batch's `checklist` |
| `links` | list of `{other, kind}`, linking from the new item, at most 100 | the batch's `links` |

They apply in the same transaction as the creation: the item is created, then
claimed, then given its steps, then linked, each step being the write the
batch's group makes, with its events. The claim starts the new item, so an item
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

A named `state` meets the refusals a move there does. A new item stands in
`triage`, `ready` or, with `claim`, its active state: a state of the categories
`review`, `blocked`, `completed` or `cancelled` is refused with the `new_item`
guard (`409 workflow_guard`), which `force` does not carry, before anything is
written. Entering one asks for what a creation does not carry — what the owner
is to check, the reason, the summary — so the item is created, then moved there
with a transition.

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
- **since 3.0**, the attached commits, except one the survivor has already,
  whose attachment to the merged item goes; `moved.commits` counts those that
  moved. The projects they gave move with the item's projects;
- the [pin](#pins), which the survivor keeps when it has one already;
- the links, each in its own direction: `MAIN-13 blocks MAIN-20` becomes
  `MAIN-12 blocks MAIN-20`. A link to the survivor or to another item of the
  same merge stays on the merged item, because moved it would tie the survivor
  to itself. A `blocks` link that arrives can make the survivor block work it
  did not block before, and one into it can make it wait.
- the [projects](#the-projects-an-item-changes), a project more than one of them
  names keeping the strongest source: `named`, then `commits`, then `migrated`.
  `moved.projects` counts the merged item's projects.

Each merged item is then linked `duplicates` to the survivor, gets a summary
naming it ("Merged into MAIN-12, which now holds its 2 steps, 1 comment, 0 refs,
3 commits, 1 link and 0 projects.", `next` "Continue in MAIN-12.", `why` the
reason), loses its claim and closes in the first `cancelled` state its workflow reaches from
where it stands, with the reason `duplicate of MAIN-12`. The survivor gets a comment
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
that refuses the close the way a transition does.

Every write is one an ordinary write makes, with its event: `linked` and
`unlinked` on both ends of each link, `checklist_replaced`, `released`,
`summarized`, `transitioned` and `overridden`. No event action, field or table is
new, so a build from before merging reads a merge as those ordinary changes. The
call is recorded once, against the survivor.

The answer is the survivor with `merged`, one entry per item in the order given,
and `warnings` and `overridden` when there are any:

```json
{"reference": "MAIN-12", "revision": 9, "merged": [
  {"reference": "MAIN-13", "work_item_id": "…", "state": "cancelled",
   "moved": {"steps": 2, "comments": 1, "refs": 0, "commits": 3, "links": 1,
             "projects": 0}}],
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
`id`, and `planning_space_id` for the `space` of `create_work_item`, `list_work_items`,
`search_work_items` and `get_planning_space` (which also reads `id`). The
canonical name is used when both are given with the same value. Both given with
different values is refused. The schemas do not list these spellings, and
nothing below the MCP surface reads them.

A Planning tool refuses an argument its schema does not have, and a required
argument that is missing, naming the tool, the argument and the arguments the
tool takes, for example
`get_work_item: unknown argument 'item'; expected 'id' (required), 'parts', 'unresolved', 'thread', 'comments_after', 'events', 'section'`.

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
| `params._meta["claudecode/toolUseId"]` (Claude Code), and the [call pair](hook-contract.md#the-call-pair) its `PreToolUse` hook left for that id | `confirmed`, with the session and agent from the pair | `claude-pair` |
| no pair for that id, and an `_identity` argument whose `tool_use_id` equals it | `confirmed`, with the session and agent from `_identity` | `claude-hook` |
| no pair, and an `_identity` argument whose `tool_use_id` differs from it | `unconfirmed`, with the session and agent from `_identity` | `claude-hook-mismatch` |
| no pair and no `_identity` | `unconfirmed`, no session | `claude-no-pair` |
| an `_identity` argument and no `claudecode/toolUseId` in `_meta` | `unconfirmed`, with the session and agent from `_identity` | `claude-hook-unverified` |
| none of these | `unconfirmed`, no session | `mcp` |

A model cannot know the id of the call it is about to make, so it can neither
leave a pair for that id nor type an `_identity` that names it; a matching
`tool_use_id` is what tells either from a guess. A pair counts only for the call
whose id it carries, and wins over an `_identity` sent beside it. Neither `_meta`
key is documented by its client; both are checked, never assumed, and each
call's row records in `source` which way its session was found, which is what
`valkama doctor` reads to warn about a client that stopped sending one.

`_identity` is the argument the `PreToolUse` hook of an earlier release added to
every call of this server; the current hook leaves the call unchanged and writes
the call pair instead. The server still reads it, so a session that runs that
hook keeps its confirmation until it restarts:

```json
{"session_id": "<hook session id>", "tool_use_id": "<hook tool use id>", "agent_id": "<optional>", "agent_type": "<optional>"}
```

Each value is a string of at most 200 characters, and other keys are ignored. A
call pair has the same shape, with `place` beside it, and is read by the same
rules: a malformed one is no pair. The server removes `_identity` from the
arguments of every tool, reads included, before it checks them against the
tool's schema, so no tool refuses it and no
handler sees it. No published input schema names it, and `tools/list` is the
same with or without a hook. An `_identity` that does not match this shape is
dropped: the call runs and is recorded as if it carried none.

When the client opened with `initialize`, the `clientInfo` name and version it
sent are recorded with each call; otherwise the client is named after the
identity channel (`codex`, `claude`). Nothing else from `_meta` is stored.

Every history event that the `events` part of `get_work_item` or the HTTP item
read answers with carries its call's identity:

```json
{"action": "claimed", "detail": "", "author": "codex", "at": "2026-10-31T09:00:00Z",
 "identity": {"state": "confirmed", "source": "codex-meta", "session_id": "019a…", "agent_id": null}}
```

An event written before calls were recorded, or by the execution runner outside
any call, has
`{"state": "unconfirmed", "source": null, "session_id": null, "agent_id": null}`.
A write from the browser UI is `confirmed` with source `browser` and no session;
see [Local HTTP security](guides/http-security.md#whose-write-it-is).

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

A call row of an edit (the batch's `update`, `POST /api/planning/work-item/update`)
names in `reason` the fields it changed, comma-separated, as the columns are
named: `title`, `description`, `source`, `priority`, `labels`, `kind`,
`parent_id`. An edit logs no event, so this is the record that a person edited
an item rather than only moved it; an edit that changed no field leaves it
null. Other Planning call rows leave it null.

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
| the session has no row, is `ended` or `failed`, or was last seen more than 3 days ago | `stale` |
| otherwise | `live` |

A claim made before calls were recorded, by a build that does not record them,
or in the browser reads `unconfirmed`: none of them names a session.

An open question to the owner on the item stops the count of silence: the holder
waits for the owner rather than having left the work. The pause is the item's,
so it covers its claim and every claimed step on it, whoever holds them, and no
other item the same session holds. An end or a missing session row still
counts, and a question addressed to a session does not stop anything.

A lease is the session's, not the record's. A claimed step records no call of its
own: it stands on the session its holder names, read from that session's newest
confirmed call, and lapses with it. When a session's lease lapses, its claim and
its claimed steps on the item are released together.

Nobody stands behind a tick that holder made any more, so the same write marks
every step the lapsed holder ticked `by_previous_holder: true`, whether the item
was at work or blocked; a tick someone else made stays as it is, and taking a
live lease over with `force` marks nothing. Entering a `review` or `completed`
state while a step stands marked is refused with the `previous_holder` guard:
`MAIN-12 has 2 step(s) ticked by a holder whose lease lapsed: tick them again to
confirm them, or reopen them`. A tick of the step, even of one already done,
confirms it and clears the mark, and so does reopening it; `force` carries the
move past the guard and records `overridden`. A cancelled close is not asked. A
step stored without the field reads `false`.

The record says whose claim the sweep released until somebody claims the item
again: `lapsed_claim` is `{"holder": …, "reason": "session-ended", "at": …}`,
read from the newest `released` event the lease expiry wrote -- `holder` as that
event names it, `reason` its cause (`session-ended`, `session-missing` or
`lease-expired`) and `at` its time. It is `null` once a claim followed that
release, while somebody holds the item, on a closed item, and on an item only
steps held, whose release names a step rather than its holder. It is derived
from the history, never stored, and stands in the full record and in every
brief record; the compact rows of `list_work_items` and `search_work_items` do
not carry it.

A session that resumes or is compacted is told these releases in its
[resume note](hook-contract.md#the-resume-note): a step marked
`by_previous_holder` stands there `(to confirm)`, and the line
`No longer held by you: …` names the open items whose claim, by this
`lapsed_claim`, or whose claimed step the sweep released after the session's
last write call.

`stale` says nobody is working the item now, not that the claim is gone. A
session that ended may come back: a client restart ends the session and resumes
it under the same id seconds later, so a lease whose session is `ended` keeps its
claim for 12 hours after `ended_at`, its grace. A `session_start` hook event or a
confirmed call from that session within the grace makes the lease `live` again,
with no write to the item. A session with no `ended_at` has no grace, and neither
has a `failed` one, which only a session start reopens.

The `claim` part of `get_work_item` and the full record of the HTTP item read
carry the lease as `claim`; the card carries only `claim_ref` and `claim_state`,
and its `parts` counts the lease:

```json
{"holder": "codex (session 019a…)", "state": "live", "session_id": "019a…", "agent_id": null,
 "source": "codex-meta", "acquired_at": "2026-10-31T09:00:00.120Z",
 "last_seen": "2026-10-31T09:40:12Z", "expires_at": "2026-11-14T09:40:12Z"}
```

`holder` is `claim_ref`. `acquired_at` is when the claiming call arrived and is
`null` for a claim that names no call; `last_seen` is the session's, and
`expires_at` is `last_seen` plus 3 days while the lease is `live`, and for an
`unconfirmed` claim the item's last history event (its `updated_at` when it has
none) plus 3 days; `null` while an open question to the owner stops the count,
and for a `stale` lease. It answers how long a session that shows no sign of
life keeps a live lease, and promises nothing about a session that ends: from
that moment the lease is `stale`, `expires_at` is `null`, and the grace above
applies. `claim` is
`null` when nobody holds the item. `claim_state` stands beside `claim_ref` in the
card, the full record, an item of an HTTP list, a compact row of `list_work_items` and
`search_work_items`, an HTTP chain member, a row of `open_members`, a row of
`stale_claims` in `GET /api/planning` and a write acknowledgement; `claim_ref`
means what it meant. Three projections carry
`claim_ref` alone: a node of `GET /api/planning/graph`, a hit of the platform
search and an item of the Exact Project read.

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
- `claim_work_item` on an item under a `stale` lease, or an `unconfirmed` claim
  past its 3 days, releases it before it does anything else, in the grace or
  not, with the steps the same session holds there: whoever asks for that item
  takes it now, without `force`, and the session that comes back later finds it
  taken. Its history reads `released` and then `claimed`.
  `claim_work_item` with `release` on a stale lease stops after that release.
- `claim_ready_work_item` first releases every lapsed hold in its space, as the
  sweep below does, except one the calling session holds. It neither gives nor releases an item whose lease is in the
  grace, because nobody asked for that item in particular.
- A task in an active state whose workflow lets it reach no `ready` state keeps
  its stale lease: releasing it would leave work with no holder, so every sweep
  skips it, and `claim_work_item` on it, a takeover included, is refused with
  `[transition]` until the task is moved.
- The release is a `released` event with the detail `<reason>: <holder>`, written
  by Valkama under its own call; an item it leaves unheld in an active state is
  put back in the queue under the same call, as any release does (see
  [A claim starts the work](#a-claim-starts-the-work)). A released step is a
  `checklist_released` event with the step's text under the same call. The
  reason names what happened to the session:

  | Reason | The session |
  | --- | --- |
  | `session-ended` | ended or failed |
  | `session-missing` | has no row |
  | `lease-expired` | was last seen more than 3 days ago, or, for a claim or step no session proved, the item had no event for 3 days |

  Releases written before the reasons were told apart say `lease-expired`,
  whatever the cause, and stay as they were written.
- A checklist step's claim records no call of its own, so it lapses with the
  session its holder names, by the same rules, read from that session's newest
  confirmed call. Releasing a lapsed lease releases the steps the same holder
  holds there in the same write, whether the grace is over or a caller asked for
  the item. A step of any other holder is released once its own lease lapses, by
  the same sweeps that release a lease, whether or not somebody holds the item,
  and a task left at work with nothing holding it goes back to the queue. A done
  step is nobody's hold, and a step of a closed item never lapses. A claim or a
  step of the session making the call stays, as `claim_work_item` keeps its
  claim: the call is that session's sign of life.
- An `unconfirmed` claim is compared by `author`, as every claim was before
  leases. It has no session to go quiet, so it lapses when its item has had no
  history event for 3 days, and so does a step whose holder no session proved.
  The owner's own claim made in the browser lapses the same way. It reads
  `unconfirmed` until the release.

With nobody calling, [the planning sweep](#the-planning-sweep) releases every
lapsed hold: each claim and claimed step whose stale lease is past its grace, or
whose `unconfirmed` hold is past its 3 days. A grace is over at exactly 12 hours
after `ended_at`, so a pass at that second releases the lease.

The space's list of abandoned claims (`stale_claims` in the read model) holds
every claim of an item at work or blocked whose lease is `stale`, in its grace or
not, and every `unconfirmed` claim whose 3 days without an event are over, until
a release takes it away.

A claim still counts as the executor that starting an item requires. Starting
an item under an `unconfirmed` or a `stale` claim answers with a warning, not a
refusal, unless the claim was taken in the browser.

### The planning sweep

Of Planning's rules only the planning sweep acts by time rather than on a call.
An MCP server and `serve` run its first pass when they start, before the first
request and within the start-up budget, and then again every 10 minutes on a
connection of their own, on the thread `valkama-planning-sweep`, for as long as
they run. Two processes passing at once need no agreement: a step changes
nothing the second time, and every write checks the revision it read. Ten minutes is a
margin against terms of 12 hours and 3 days, and between passes
`claim_ready_work_item` and `claim_work_item` still release what they meet.

A pass runs its steps in order, each in a transaction of its own:

| Step | What it does |
| --- | --- |
| `leases` | releases every lapsed claim and claimed step, as [above](#who-holds-a-claim-or-a-step), and marks the lapsed holder's ticks |
| `waiting` | leaves [words waiting](#words-that-wait-for-a-session) on a goal or stage that a session stopped working on while its claim, step or subscription still stands -- it ended, or went quiet past the lease -- once no live session works there; the words are what a person did there after that session's last call, and they wait under a call of `valkama` with the tool `waiting-recovery` |
| `subscriptions` | removes every [subscription](#subscriptions) and mute whose session lapsed |
| `returns` | brings back [work put off](#putting-work-off) whose day or time passed, or whose item closed by a path that did not bring it back, one call of `valkama` under the tool `deferral-return` per item |
| `commits` | takes the commit records no client hook took within an hour, each decided by its session, and deletes those that change nothing, as the [hook contract](hook-contract.md#taking-the-records) describes; a record it applied is deleted at the next pass |
| `confirmations` | asks the owner to confirm a goal or stage that awaits confirmation with no live session working there, or unconfirmed a day after its wait began, once in a period of waiting, under the tool `confirmation-question`; and records the wait, with its event, of one a write left unrecorded (see [Completing a goal or stage](#completing-a-goal-or-stage)) |

Every step keeps the same contract:

1. A second pass in a row changes nothing.
2. It writes as Valkama's own call, with the step's name as the call's tool
   unless its writes carry a name of their own -- a lease expiry is `released`
   by `valkama` under the tool `lease-expiry`, one call per item -- so the history
   says who released what and why.
3. It changes at most 200 items in one pass; the next pass takes the rest, by
   number.
4. It reads the time from the one clock the lease terms are read against.

A step asks first, without the write lock, whether it has anything to do, and
one that has nothing takes no lock. A store another writer holds is given up
after a quarter of a second, and the step waits for the next pass. A step that
fails is rolled back and said once on the process's stderr -- again only after
a pass it got through -- and the steps after it still run. The start-up pass
says on stderr how many items it released a hold on, and which steps it left
for the next pass.

### A claim starts the work

The decision and the alternatives it was chosen over are in
[ADR 0012](decisions/0012-claims-start-work.md).

Taking an item is the moment its work starts, so a claim moves an item that has
not started into the workflow's active state, and a release moves work under way
back to where the take-next queue finds it. Both follow the state's category,
never its name. The rule holds for every write that claims: `claim_work_item`,
`claim_ready_work_item`, the `claim` of `create_work_item` and of
`apply_work_item_changes`, their HTTP writes, the browser, and a launch.

Only a task is held. A claim of a goal or stage, or of one of its steps, is
refused: `a goal or stage has no holder; claim a task under it`.

| The task is in | A claim (a take or a takeover) | A release (by its holder, `force`, or lease expiry) |
| --- | --- | --- |
| a `triage`, `deferred` or `ready` state | moves it to the first `active` state, in workflow order, that a transition of the workflow reaches from where it stands; from `triage` or `deferred` it is accepted, `inherited` under goals and stages that are all accepted and open, `owner` for a claim in the browser and `assignment` otherwise | moves nothing |
| an `active` state | moves nothing | moves it to the first reachable `ready` state, unless a step of it is still claimed |
| a `blocked` state | moves nothing | moves nothing; the holder is gone |
| a `review` state | refused: the owner's answer returns it to `ready` | moves nothing |
| a `completed` or `cancelled` state | refused: reopen it first | moves nothing |

A claim of a step of a task in `triage`, `deferred` or `ready` starts the task as
a claim of the task does, and is refused where a claim of the task is. The last
hold on an active task ending -- its claim released or expired, or its last claimed
step released or ticked, with nobody holding the item -- requeues it the same way.
In `apply_work_item_changes` that is decided once, at the end of the batch: a
batch that releases the last step and then moves the task to `review` moves it
from work to review, not by way of `ready`.

A move is the transition a `transition` group of `apply_work_item_changes`
makes: the workflow's guards judge it, it writes a `transitioned` event whose
detail is the new key and the reason (`dev: claimed`, `ready: released`,
`ready: session-ended`, `dev: launched` for a launch), it bumps the revision once
more, and the item goes last in its new state. A claim's move needs no further
executor, because the claim is it. Its answer, full or acknowledged, adds
`started: {"from": "triage", "to": "dev"}`; a release's adds
`requeued: {"from": "dev", "to": "ready"}`; and the move's warnings, such as a
claim no session confirmed, arrive in `warnings`.

An active item whose checklist still has a claimed step is released and stays
active, because that step's holder is still its executor. Two cases are refused
with `workflow_guard` instead, before anything is written, because a holder stands
only on work at work or blocked and work at work always has one:

- A claim of a startable item whose workflow lets it reach no active state:
  `[transition] MAIN-12 stays in Triage: its workflow has no active state it can
  move to`.
- A write that would end the last hold on an active item with no reachable
  `ready` state, a return to `triage` being no way back since it would undo the
  acceptance: `[transition] MAIN-12 would stand at work with nobody holding it:
  its workflow lets it reach no ready state to go back to; move it first`. The
  release, the step release or tick, and the takeover of a stale claim on it are
  each refused; a lease sweep leaves its lease in place.

A blocked task says something a claim does not undo, so a claim takes it over
without moving it. Release requeues because a claim starts its item: without it,
a released or expired claim would leave work in an active state with no holder,
which the model never allows, that `claim_ready_work_item` never offers again. A
requeued task keeps its checklist, comments and history, and goes to `ready`,
never back to `triage`, so the queue offers it before work nobody has accepted.

`transition` sent beside `claim` in one `apply_work_item_changes` call applies
after the claim's move: `{"claim": true, "summary": {…}, "transition": {"state":
"review", "to_check": "…"}}` moves a task in `triage` with no open step to `dev` and
then to `review`.

### A close ends the claims

A claim says somebody is working the item, and nobody works a closed one, nor
one in `triage`, `ready` or `review`. So a transition into any state but an
`active` or `blocked` one -- a terminal state, `completed` or `cancelled` by
`is_terminal`, among them -- releases the item's claim in the same write, whoever
holds it.
The rule is in the one transition every surface makes: the `transition` group
of `apply_work_item_changes`, the HTTP transition, a
drop on the board's Done column and the card's state menu. Closing therefore
takes one write, and the item stops reading as held at once instead of when its
lease runs out. `merge_work_items` already released each merged item before
closing it, and still does.

The history records the release beside the transition, with the same author
and call: `transitioned` (`done`), then `released` with the holder's
`claim_ref` as its detail. The answer names that holder as `released`, in the
acknowledgement, the `verbose` card and the HTTP answer, and in
`applied.transition` of a batch: `{"state": "done", "released": "codex (session 019a…)"}`.
A close of an item nobody holds releases nothing and carries no `released`. A
move to `ready`, `triage` or `review` releases the same way; a move among the
`active` and `blocked` states keeps the claim.

A close also ends every request still pending on the item -- a question or a
decision, asked of the owner or of an agent session, and a list under a comment --
in the same write. Each is written `expired`, with `expired_reason: item_completed`
when the item closes into a `completed` state and `item_cancelled` when it closes
into a `cancelled` one, and gets a `request_expired` event naming the request, after
the `transitioned` one, with the close's author and call. When a person closes the
item, the agent that asked hears it as `question_withdrawn`, as it hears any question
a person takes back (see [the hook contract](hook-contract.md#who-is-told)), and
reads the reason on the request. A request that had already lapsed, past its
deadline or on an execution that ended, is written with that reason, `deadline` or
`execution_closed`, and gets no event: the close did not end it.

A checklist step's claim ends too, recorded as `checklist_released` with the
step's text. A completed close never has one: the guard requires every step
ticked, and a tick clears the step's claim. A cancelled close leaves its undone
steps open, and so can a close `force` carried past the checklist guard; those
steps stay open and become unheld, so a reopened item does not read as being
worked by their former holders.

Reopening a closed item -- a transition back to an open state -- restores no
claim and no request: whoever takes the work again claims it, and a question the
close ended stays ended, since it was about the item before the close; one still
needed is asked again.

Who held the item is still on the record. The card (`get_work_item`, a
`verbose` answer), the full record (`GET /api/planning/work-item`) and the briefs of the HTTP
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

### Completing a goal or stage

A goal or stage is done when nothing under it is open, so a move of one to a
`completed` state is refused with the `children` guard (409 `workflow_guard`) while
an item under it, at any depth, is open, one in `triage` or `deferred` included.
`force` does not carry it, and a person meets it as an agent does. The message names
up to five of the open items and counts the rest: `[children] MAIN-3 has 7 open
item(s) under it: MAIN-4, MAIN-5, MAIN-6, MAIN-8, MAIN-9 and 2 more; close, cancel or
move out what is open under it, and it awaits confirmation once nothing is`.

**Awaiting confirmation.** The write that closes, moves out, moves away or deletes
the last open item under an accepted open goal or stage brings it to
`container_state: awaiting_confirmation`, and in the same transaction:

- the answer of that write, over HTTP and as an MCP acknowledgement, adds
  `awaiting_confirmation`, the references of the goals and stages that came to wait
  in it. Confirming the last open stage under a goal is such a write: the goal comes
  to wait in it;
- Valkama records `awaiting_confirmation` on the goal or stage in a call of its own,
  with the tool `awaiting-confirmation` and the author `valkama`. Its detail names
  what closed without being done and what left, such as `cancelled MAIN-12, MAIN-14;
  moved out MAIN-15`, at most 512 characters, the references that do not fit counted
  as `and N more`. A goal or stage with no steps ends it with `no steps: check it
  against its description`. The record's kind asks for a session, so it wakes the
  sessions working there (see [the hook contract](hook-contract.md));
- when an agent's write did it, that agent's top-level session follows the goal or
  stage, so a coordinator whose subagent closed the last task hears it. A person's
  write and Valkama's own subscribe nobody.

While it waits, a read of it by parts names the part `confirmation` in its card's
`parts`, with `count` the items it lists, and reads it by that name:

| Field | What it holds |
| --- | --- |
| `since` | when this period of waiting began |
| `steps` | how many steps the goal or stage has; 0 means it is checked against its description |
| `cancelled` | the items under it that were cancelled, each `{reference, reason}`: the reason of the move that cancelled it, else its summary's `why`, else its `done`, else `null` |
| `moved_out` | the items that left it and did not come back, each `{reference, reason}`: the reason the move out gave, or `moved under MAIN-7`; `null` where the move recorded none |
| `asked` | the id of the owner's confirmation question, once it is asked; `null` before |
| `left_for_next_session` | when the owner left it to the next session; `null` otherwise |

A goal or stage that does not wait has no such part, and a read that names it answers
without the field.

**Confirming.** Any session or a person confirms it by completing it, under the guards
a task meets: every step ticked and a summary. Whoever confirms checks its steps, or
its description when it has none, against what was done; when something is missing,
they file a task under it, which brings it back to work. A new or reopened item under
it, or one moved under it, ends the wait in that write, and an open confirmation
question ends `expired` with `expired_reason: withdrawn`.

**The owner's question.** The planning sweep's `confirmations` step asks the owner
when no live session works on the goal or stage (see [Participants](#participants)),
or when a day has passed since the wait began and nobody confirmed it. It asks once
in a period of waiting, in a call of Valkama's own with the tool
`confirmation-question`: `kind` `question`, purpose `confirm`, the prompt `All work
under MAIN-3 is closed: confirm it, or leave it to the next session that takes work in
this space.` followed by what was cancelled and what moved out, each with its reason,
and its steps, or `It has no steps: check what was done against its description.`,
and one required choice field, `answer`, with the options `confirm` (`Confirm it`)
and `leave` (`Leave it to the next session`).

Only a person answers it, in Valkama (`owner_only`, 403, for an agent), and as with
[review's question](#review-asks-the-owner) it is not declined, its answer is not
changed and an own variant is no answer to it (`[purpose]`). Valkama asked it, so
nobody withdraws it (`not_asker`, 403): the write that ends the wait ends it. The
answer is carried out in the write that gives it, and a refused move refuses the
answer; the answer's record says what it did as `carried_out`:

- `confirm` ticks the open steps as the person's, writes the summary `done`
  `Confirmed by the owner: all work under it is closed.`, `next` `Nothing: the work
  under it is closed.` and the answer's note as `why`, and moves it to the first
  `completed` state of its workflow: `carried_out: completed`;
- `leave` leaves it as [words that wait](#words-that-wait-for-a-session) for the first
  session that takes work anywhere in its space, with the scope `space`, and records
  `left_for_next_session`: `carried_out: left_for_next_session`. It goes on waiting,
  and no question is asked again in this period.

A session's confirmation while the question is open completes it, which ends the
question with `expired_reason: item_completed`. A confirmation question does not hold
that completion (see [the `question` guard](#review-asks-the-owner)).

### Cancelling a goal or stage

A goal or stage is cancelled with the open work under it, at any depth, so a cancel
of one with open work under it takes two calls: the first answers with what would
close, the second confirms it.

The first call, a move of the goal or stage to a `cancelled` state without
`cancels`, is refused with code `cancel_list` (409), and nothing is written. `force`
does not carry it, and a person meets it as an agent does. Its body carries, beside
`code` and `message`:

| Field | What it holds |
| --- | --- |
| `cancels` | the open items under it, at any depth, in number order: `reference`, `title`, `kind`, `state` (`{key, name, category}`, `null` for an accepted open goal or stage) with `container_state`, and `holder`, who holds the item or one of its steps, empty when nobody does |
| `dependents` | the open items outside that list that wait on one of its items or on the goal or stage itself: `reference`, `title`, `kind`, `waits_on` and `how`, `blocks` for a `blocks` link and `deferred` for work [put off](#putting-work-off) until it; one row for each item waited on |
| `list_token` | 16 hexadecimal digits that fingerprint the list |

The second call is the same move with `cancels` set to `list_token`. The server
builds the list again and cancels exactly that list when its token matches; when
it does not, because work was filed under the goal, a holder or a state changed, or
a dependent came or went, the call is refused again with the new list and its
token, and nothing is cancelled. A new title, description or comment changes no
token. The token is the first 16 hexadecimal digits of the SHA-256 of
`{"cancels": [[reference, state, holders], ...], "dependents": [[reference, waits_on,
how], ...]}` written as JSON with sorted keys, no spaces and ASCII only, where
`state` is the item's state key or, for an accepted open goal or stage, its
`container_state`, `holders` is the sorted `holder` list, and each table is sorted.
It holds nothing on the server, so any caller that read the list gets the same one.

In that one write every item of the list moves to the first `cancelled` state its
workflow reaches, the deepest first, with the reason `cancelled with MAIN-3`, so its
`transitioned` detail reads `cancelled: cancelled with MAIN-3`. The guard for what a
person did holds for the goal or stage named, not for the work under it. Each
closes with a summary written as a new report: one without a summary gets `done`
`Cancelled with MAIN-3.` and `next` `Nothing: the goal or stage it served was
cancelled.`; one with a summary keeps its `done` and gets `next` `Nothing: cancelled
with MAIN-3, the goal or stage it served.`, the summary before staying a report in
its comments. The goal's or stage's `reason`, when the move gives one, is each
summary's `why`. Their claims and step claims end and their requests end as
[a close ends the claims](#a-close-ends-the-claims) says. An item of the list whose
workflow reaches no `cancelled` state refuses the whole cancel, before any list is
handed over: `[transition] MAIN-14 is under MAIN-3 and cannot be cancelled from where
it stands`. `cancels` with any other move, a task's cancel among them, is refused with
`invalid_request`.

The answer, and `applied.transition` of a batch, adds `cancelled`, the references of
the items under it the cancel closed, and `released`, a list of `{reference,
holder}` for each claim it ended on them, in place of the one holder a close names.

A cancel of a task, or of a goal or stage with nothing open under it, is one call.
Any close, completed or cancelled, adds `freed`: the open items it blocked that
nothing open blocks any more, by reference. An open item still linked `blocks` to a
cancelled one names it in `cancelled_blockers`.

### Moving work out of a goal or stage

An item leaves its goal or stage with a reason, by the `move_out` group of
`apply_work_item_changes` or `POST /api/planning/work-item/move-out` with
`{id, reason, force?, expected_revision?, author?}`. In one write:

- it goes to the top level, and to the first `triage` state its workflow reaches
  from where it stands, or stays in the `triage` state it is in; its
  `transitioned` detail reads `triage: moved out of MAIN-3: <reason>`;
- it keeps `started_at`, its claims and step claims end (`released`), and its
  basis goes, as every move to triage takes it;
- a goal or stage takes the work under it along and becomes a goal; an accepted
  one goes to triage too, though no move puts one there, and the work under it
  stays as it was, which the queue does not give while the goal stands in triage;
- the goal or stage it left records `child_left` with the detail `MAIN-12:
  <reason>`, which its [`confirmation` part](#completing-a-goal-or-stage) reads,
  and comes to await confirmation when nothing under it is open any more.

The answer adds `moved_out: {from, reason}`, `from` the reference of the goal or
stage it left; over MCP the acknowledgement carries it, and `applied.move_out`
says `state`, the key of the triage state, and `released`. It is refused with
`invalid_request`, nothing written, without a `reason` (`[move_out]`), for an item
under no goal or stage or a closed one (`[move_out]`), for one whose workflow
reaches no `triage` state (`[move_out]`), and for one another session holds:
`MAIN-12 is held by …; pass force to move it out anyway`. `force` carries the
last through and records `overridden` with `claim`.

**Moving under another goal or stage** is the edit `update {parent}`. The goal
or stage it left records `child_left` with the detail `MAIN-12: moved under
MAIN-7`, and both come to await confirmation, or stop, in that write. The new
parent meets the rules of a creation's, and two more:

- an accepted open item, one with a basis and in neither `triage` nor
  `deferred`, is refused under a goal or stage that, or one over which, stands in
  `triage` or `deferred`: `[parent] an accepted item does not move under a goal or
  stage that is not accepted: accept it first, or move the item out`;
- an item in `triage` moved under goals and stages all accepted and open is
  accepted with them, as if filed there: basis `inherited`, a task in the first
  `ready` state its workflow reaches, a goal or stage in the service state with
  the work in triage under it, and the reason `moved under MAIN-7`. An item put
  off stays put off.

A parent in another space is refused as before.

### Converting a task into a goal or stage

A task becomes a goal or stage, and a goal or stage with nothing under it a task
again, by the `convert` group of `apply_work_item_changes` or
`POST /api/planning/work-item/convert` with `{id, to, leftover?, force?,
expected_revision?, author?}`. `to` is `stage` for a task under a parent and
`goal` for one without, the word its place gives, or `task`, `bug` or
`improvement` for a goal or stage. In one write:

- the item keeps its number, title, description, comments, history, links,
  questions, subscribers, refs, steps with their ticks and the wait it was put
  off on; a `bug` or `improvement` made a goal or stage takes its kind as a label;
- a task accepted and open comes to stand in the service state, recorded `opened`
  with `converted from a task`, and loses `started_at`, which a goal or stage
  reads from the work under it; a goal or stage accepted and open goes to the first
  `ready` state, recorded `transitioned` with `<key>: converted from a goal`; each
  keeps its basis, and one in `triage` or `deferred` stays there;
- its claim and step claims end (`released`, `checklist_released`);
- a held task, by its claim or a claim of a step, leaves the work at hand in a new
  task under it: its holder with the call that took the claim, so the lease reads
  as it did, every claimed step with its claim (`claimed`, `checklist_claimed`),
  the steps `leftover.steps` names by `item_id`, with their ids and ticks, the
  title `leftover.title` or the task's own, its kind, priority, `started_at` and
  projects. It stands in the first `active` state, or in the task's `blocked`
  state for the same reason, with the basis `inherited` under goals and stages all
  accepted and open, else the task's. A task nobody holds leaves one only when
  `leftover` is sent, in the first `ready` state, or `triage` when the item is in
  triage or deferred; without one the task's projects are dropped, since a goal
  or stage names none;
- the top-level session of each holder follows the converted item;
- the goal or stage it stands under, and the item, are marked: a goal or stage
  made a task stops awaiting confirmation, and its `confirm` question is
  withdrawn.

The item records `converted` with the detail `task -> stage`, then `; leftover
MAIN-15: 2 steps`, how many steps went to the new task, and `; projects dropped:
alpha` when so. The answer adds `converted:
{from, to, leftover, projects_dropped}`, `from` and `to` the kinds, `leftover`
the new task's reference or null; over MCP the acknowledgement carries it, and
`applied.convert` says `kind`, `state` (null for a goal or stage accepted and
open, with its `container_state`) and `released`. It is refused with
`invalid_request`, nothing written, for another word, naming the one that passes
(`[convert]`), for a closed item, one in `review`, a goal or stage with any item
under it (one that left does not count) or with `leftover`, and a step
`leftover` does not find (`[convert]`); with `workflow_guard` for an agent's
conversion while a question to the owner other than a `confirm` one is open on
it (`question`, which `force` does not carry); and for an item another session
holds: `MAIN-12 is held by …; pass force to convert it anyway`. `force` carries
the last through and records `overridden` with `claim`.

The refusals that lead here name the word that passes: a parent that is a task,
`MAIN-12 is a task and holds no children: convert it first, with convert {to:
stage} in apply_work_item_changes` (`goal` for one without a parent); an edit of
a task's kind to a goal or stage, `an edit changes kind among task, bug and
improvement: MAIN-12 becomes a stage with convert {to: stage}`; and of a goal's or
stage's kind to a task, `an edit does not make a goal or stage a task: MAIN-12
becomes one with convert {to: task}, and goal or stage follows from the parent`.

### Putting work off

Work that is to wait is put off by the `defer` group of `apply_work_item_changes`
or `POST /api/planning/work-item/defer` with `{id, until, reason, force?,
expected_revision?, author?}`. A `transition` into a `deferred` state is refused,
naming `defer`. `until` is one of:

- a day, `2026-12-01`, which comes at 00:00 UTC;
- a time with its zone, such as `2026-12-01T09:00:00Z` or `2026-12-01T12:00:00+03:00`;
- the reference or `work_item_id` of the open item whose close it waits on: not
  the item itself, and not a goal or stage it stands under, which closes only
  once nothing under it is open.

`reason`, at most 400 characters, says why the work waits; the owner reads it when
it comes back. In one write the item moves to the first `deferred` state its
workflow reaches, with the `transitioned` detail `deferred: until 2026-12-01:
<reason>`; its basis goes and its claims and step claims end (`released`), as on
every move there. An item put off already stays where it is and takes the new
condition. The answer adds `deferred`, and `applied.defer` of a batch says `state`,
`deferred` and `released`. It is refused with `invalid_request`, nothing written,
without `until` or `reason`, for an `until` that is no day, time or open item it
may wait on or a moment already past, and for a closed item (`[deferral]`); and for one another session holds: `MAIN-12 is
held by …; pass force to put it off anyway`. `force` carries the last through and
records `overridden` with `claim`.

The full record and the card of an item put off carry `deferred`:

| Field | What it says |
| --- | --- |
| `until`, `until_item` | the moment it comes back, or the reference of the item it waits on; one of them is `null` |
| `reason`, `since`, `by` | why, when and who put it off: `by` is `{author, session_id}` of that call; the card leaves these to the history |
| `reached_at` | when its condition came while the owner is asked whether to take it up; otherwise `null` |

**Coming back.** The work comes back when its day or time passes, read by the
sweep's `returns` step and by `claim_ready_work_item` for its space before it reads
the queue, and in the write that completes, cancels or deletes the item it waits
on. An item merged away passes the wait to the item it merged into. It comes back
to the first `triage` state its workflow reaches, with the `transitioned` detail
`triage: returned, date 2026-12-01` and a `returned` event whose detail is `date
2026-12-01`, `completed MAIN-12`, `cancelled MAIN-12` or `deleted MAIN-12`. While
that move is its newest, its record carries `returned`: `because` (`date`,
`completed`, `cancelled` or `deleted`), the `item`, `null` for a date, and `at`. A
close or a delete that brought work back answers with `returned`, the references
it brought back.

Under goals and stages all accepted and open, or when its workflow reaches no
`triage` state, the item stays put off with `reached_at` set, and Valkama asks the
owner a question of purpose `return`: `MAIN-12 was put off until 2026-12-01; that
has come. Do it, put it off again, or drop it.` It is asked once: the item waited
on closing again, or being deleted, asks nothing more. A delete of that item, before
or after its close, leaves `until` at the moment the condition came and
`until_item` `null`. Its one required choice, `answer`,
takes `do`, `later` with the text `until`, or `drop` with the optional text
`cancels`, a cancel list's token. As with [review](#review-asks-the-owner), only a
person answers it, and the answer is carried out in the same write: `do` moves the
item to its first `ready` state (`carried_out: ready`), `later` puts it off until
the new condition (`deferred`), `drop` cancels it with a summary saying the owner
dropped it (`cancelled`). While the question is open an agent's claim of the item,
and its move anywhere but a cancelled state, is refused with
`acceptance_question`, which `force` does not carry.

A claim, or any move out of `deferred`, a cancel included, ends the condition and
withdraws its question; moving the item under another parent keeps them. A read
writes nothing: a condition that came stands until a write brings the work back.

**A goal or stage put off** keeps the work under it with whoever holds it, and the
queue gives none of it (`ancestor_deferred`) until it comes back. The sessions
working under it hear that it was put off and that it came back, once each; an
agent's write wakes none of them, a person's wakes them all.

### Review asks the owner

A move into a `review` state from a state of another category is an agent handing
its result to the owner, so it needs what a close needs and says what to check:

- every step done and a summary (`checklist`, `summary`), and no step marked
  `by_previous_holder` (`previous_holder`); `force` carries these;
- `to_check`, text of at most 8000 characters naming what the owner is to check.
  Without it the move is refused with `review_question`, which `force` does not
  carry. `to_check` on a move to any other state is refused with `invalid_request`.

A move between two `review` states is no entry and asks nothing.

The move asks the owner a question in the same write: `kind` `question`, purpose
`review`, the `to_check` text as its prompt and one required choice field,
`answer`, with the options `accept` (`Accept it`) and `return` (`Return it to
work`). The transition's answer names it as `review_request_id`, in
`applied.transition` of a batch too. The owner's alert for it is the review alert,
not a question alert; another question asked in the same call still raises its own.

Only a person answers it, in Valkama: an agent's answer is refused with
`owner_only` (403). It is not declined and its answer is not changed, and an own
variant is no answer to it: each is refused with `invalid_request`, the message
starting `[purpose]`. The answer is carried out in the same write as the move it
names, under the same guards, and a refused move refuses the answer: `accept`
moves the item to the workflow's first `completed` state, `return` to its first
`ready` state, with the answer's note as the move's reason when it fits. The
answer's record says which as `carried_out`, `completed` or `ready`. Only the
session that asked withdraws the question (`not_asker`, 403, for anyone else, a
person included); the withdrawal, `expired` with `expired_reason: withdrawn`,
returns the item to `ready` with the reason `review withdrawn`, and its record
says `carried_out: ready`. A returned item keeps `started_at`.

Leaving review by any other move ends the question: a close as
[a close ends the claims](#a-close-ends-the-claims) says, and a move to an open
state as `expired` with `expired_reason: withdrawn`.

An agent waits for the owner's answer. An agent's move that completes an item, or
that takes it out of `review` to anything but a `cancelled` state, is refused with
the `question` guard while a question asked of the owner is open on the item, and
`force` does not carry it: `[question] MAIN-12 has 1 open question(s) to the owner,
and an agent does not complete it over them: wait for the owner's answer, or
withdraw a question you asked`. A question asked of an agent session does not
count, and a confirmation question does not hold a completion. A person's move is
not held.

A launch moves nothing. The ending of a launch writes its comment and leaves the
item where its agent left it; the launched agent moves the item to `review` with
`to_check` when the work is done. A task its launch left at work goes back to
`ready` when the launch's claim lapses. That claim is taken in a call of the
launch's own (`identity_source` `launch`) and is the lease of the session the
launch started, so it lapses 12 hours after that session ends. The session is
the client's own when the launch assigns or resumes it, and the launch's
(`launch-…`) on a fresh run of a client that announces its session once it runs,
as Codex does; the session that client announces does not hold the claim, and a
resume of that item reattaches to it.

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
| `text` | what it said, at most 1500 characters, the last one `…` when cut: a comment's body, a report's `done`, an answer as `label: choice` pairs and its note, or a review's summary (see [Reading a question](#reading-a-question)), the prompt of a question asked, declined or withdrawn, an edit's fields as they read now, a step's or a link's detail; absent when there is nothing to quote |
| `cut` | `true` when `text` was cut at the 1500 characters, the rest being in `get_work_item`; absent when it is whole |

**Since 2.5**, four more kinds:

| `kind` | When | Also carries |
| --- | --- | --- |
| `reply` | a person replied in a thread; a new root is still told as `comment` | `comment_id`; `reply_to` or `reply_to_request`, the root; `text`, the reply |
| `thread_resolved` | a person marked a root resolved | `comment_id`; `text`, the decision |
| `thread_reopened` | a person removed the mark | `comment_id` |
| `question_changed` | a person changed a given answer | `request_id`; `text`, [what changed](#the-difference-between-two-answers), within the 1500 characters |

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
| `mentioned` | a person named this item in the `mentions` of a comment, a report, a summary or a description on another item (see [Mentions](#mentions)) | `comment_id`; `from`, the reference of the item that comment stands on; `text`, the comment. For a description: `in: "description"` and no `comment_id`; `from`, the item whose description it is; `text`, the description from the line that names this item |

```json
{"kind": "mentioned", "via": "interface", "at": "2026-11-05T20:31:00.000000Z",
 "comment_id": 61, "from": "MAIN-12", "text": "Decided to keep the old route; MAIN-14 can drop it."}
```

It counts in the window and in the `person_spoke` guard as the other kinds do. Another
agent's mention is never one of these events: it is an agent's words, and it reaches
the holders through the hook and the item's `mentions`, never through `from_person`.

**Since 3.0** a text is whole up to 1500 characters, where it was cut at 300, and a
cut one says `cut: true`; the one bound holds for `from_person` and for the hook's
notices alike. The whole text is in `get_work_item` and `get_work_item_request`. Filing an item,
attaching a session and a recorded override are never told. A drag within a
state, or an edit that changed nothing, says nothing.

**On every agent write.** The answer carries the window as it stood before that
write, as `from_person`, and no key at all when it is empty. It holds the newest
20 events, and `from_person_omitted` counts the earlier ones it left out. It is
read inside the write's own transaction, so a person's write that lands while the
call runs is either in this answer or in the next window, never in neither. An
HTTP write answers without it, and no schema of the interface changed.

### Words that wait for a session

A goal or a stage is never held, so what a person does on one reaches the agent
sessions that work under it, through their hooks, and nobody when no live session
works there. **Since 3.0** such words wait on the goal or stage for the next
session that takes work under it. A person's act on a goal or stage -- a comment,
an edit or any kind above -- while no live session holds work under it or under a
goal or stage over it, or follows one of them, leaves its words waiting from that
act on. Filing a goal or a stage leaves nothing. One record waits per goal or
stage: a later act adds to what it holds rather than adding another. Words also
wait when the session that worked there went quiet past its lease or ended
without hearing them: Valkama's release of its lapsed claim leaves what a person
did over the work after that session's last call, if nobody else works there.
A session can stop working there before anything is released -- it ended while
its claim waits out its grace, or it went quiet past the lease while its
subscription stands -- and the [planning sweep](#the-planning-sweep) leaves the
same words for it.
A record Valkama makes on a goal or stage in a call of its own waits the same way
when its kind is one that asks for a session, which wakes whoever works there; no
kind asks yet, so today only a person's words wait.

A claim of a task, or of one of its steps, by an agent session its client proved
takes every word waiting on the goals and stages over the task, in the claim's
own transaction: a refused claim takes nothing. The MCP answer of the claim --
`claim_work_item`, `claim_ready_work_item`, `claim_work_item_checklist_item`, and
`apply_work_item_changes` or `create_work_item` with `claim` -- then carries
`waiting`, one entry per goal or stage that still holds words for the session:

```json
"waiting": [{"reference": "MAIN-10", "title": "Release 3.0",
  "said": [{"kind": "comment", "via": "interface", "at": "2026-11-16T09:12:03Z",
            "comment_id": 412, "text": "Keep the old route until the docs are out."}]}]
```

`said` holds what a person did there from the act that left the words to the
claim, as the entries of `from_person`, and such a record of Valkama's with
`via: "valkama"`: the newest 20, with `omitted` counting the
earlier ones when there are more, and each text whole up to 1500 characters, a
longer one cut there with `cut: true`. A whole text has no `cut`. The words are
taken once: the next claim under the same goal gets nothing until a person acts
there again with nobody working. A session also hears each act once: a goal or
stage whose acts it already got through another of its open words is no entry,
though both stay as the record. They never lapse, and they go with their item.
The key is absent when nothing waited for the session, and the HTTP answer of a
claim never has it: the interface takes no work for an agent.

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

A number in a text is a link and tells nobody: texts name other items all the
time. To tell the work on another item, the write that puts the text names that
item in `mentions`, a list of items by reference or work item id. The text stays
where it is written, and the item it names gets a record that points to it.

**Writing.** These writes take `mentions`:

| The text | Writes |
| --- | --- |
| a comment, a root or a reply alike | `POST /api/planning/work-item/comment`, the `comment` group of `apply_work_item_changes` and each comment where a batch writes several |
| a report | `POST /api/planning/work-item/report` |
| the summary | `POST /api/planning/work-item/summary`, the batch's `summary` |
| the description | `POST /api/planning/work-item/update` beside `description`, the batch's `update` |

The text is not changed and is not read for references.

```json
{"id": "MAIN-12", "body": "Decided to keep the old route; MAIN-14 can drop it.",
 "mentions": ["MAIN-14", "MAIN-15"]}
```

A summary and a description are written again and again, so their write tells
only the items the text it replaces did not name, as prose names them: saving the
same words twice wakes nobody twice, and an item a save leaves out of the text is
news again when a later save names it. A report made current replaces the summary
and follows the same rule; any other report, and every comment, tells each item it
names. An item left out this way is checked like the others, but it gets no record
and counts toward no hour.

A call through the interface names at most 20 items, any other call at most 5, and
a session mentions one item at most 3 times an hour. Refused before anything is
written:

| Case | Refusal |
| --- | --- |
| more items than the call may name | `invalid_request`: `mentions holds at most 5 items` (20 for the interface) |
| an item named twice | `invalid_request`: `mentions names MAIN-14 twice` |
| the item written on | `invalid_request`: `an item does not mention itself` |
| an item that does not exist | `not_found` |
| a fourth mention of one item within an hour by one session | `mention_limit`: `MAIN-14 was mentioned 3 times in the last hour by this session; write once there, or wait` |
| an edit that names items and sends no `description` | `invalid_request`: `mentions are told by a description: send it with them` |

The hour counts the mentions of that item whose confirmed call names the same
session, its subagents included. A call with no session, the interface's or an
unconfirmed one, is not counted, and an unconfirmed call tells nobody either. A
closed item can be mentioned: the record is written and nobody is told. Over HTTP,
`mention_limit` answers 429.

**What is written.** Each item named gets one history event, `mentioned`, under the
call that wrote the text. Its detail says where the words are: the comment's id, a
report and a summary being comments too, or `description:` and the work item id of
the item whose description it is. That call belongs to the item written on, so a
mention does not move the [window](#what-a-person-did-reaches-the-agent) of the
item it names, as the far end of a link does not.

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
call proved no session`. The tools' acknowledgements carry it as `mentions`, and
only when the call told an item. An HTTP answer that is the whole item -- the
report, summary and edit writes -- carries it as `mentions_told`, since that
item's own `mentions` are the records described below. A batch's
`applied.comment`, each entry of `applied.comments` and `applied.summary` carry
the same `mentions`; an `update`'s stand beside `applied`.

**Reading.** Every comment, in every read, carries `mentions`, the references it
named, `[]` when it named none. The `mentions` part of `get_work_item` is the 50
newest texts that named this item, oldest first, with `mentions_total`; the card
only counts them in its `parts`, and so a tool's `verbose` answer carries none.
The HTTP item read carries the newest 50 and the total, and so does every HTTP
answer that is the whole item, the HTTP writes among them.

```json
{"in": "comment", "comment_id": 61, "from": "MAIN-12",
 "at": "2026-11-05T20:31:00.000000Z", "by_person": false, "author": "codex",
 "quote": "Decided to keep the old route; MAIN-14 can drop it."}
```

`in` says where the words are: `comment` for a comment or a reply, `report`,
`summary` for a report that is its item's summary now, or `description`.
`comment_id` is that comment's id, and null for a description. `from` is the
reference of the item the words stand on now, and `quote` the first 300
characters of a comment's body or a report's `done`, or of a description from the
start of the line that names this item, the last one `…` when cut. When that
comment, or that description, went with a deleted item, the record stays and both
are `null`. `by_person` is read from the call, as on a comment. The card of the
item named shows each record as a quiet line in its discussion, by time, leading
to the comment; it is not a thread there, and an answer goes in the comment's own
thread.

**Who hears.** A person's mention is the person's act on the item named: it is a
`mentioned` event in [`from_person`](#what-a-person-did-reaches-the-agent), counts
in the `person_spoke` guard, and wakes an idle holder as any act of a person does.
An agent's mention is never a person's, whatever `author` it signs: it is not in
`from_person` and does not count in `person_spoke`. The holders hear it at their
next tool call, in a block of the notice of its own. It wakes a session or
continues its turn only when its comment
[waits for a reply](#a-comment-that-waits-for-a-reply): then it wakes the holders
of the item named, once and within a day of being written. Who is told and when is
in [the hook contract](hook-contract.md#who-is-told). With nobody holding the item,
the record waits on it for whoever takes it next.

**Merging.** A record stays where it was written: the mentions of a merged item
stay on it and do not move to the survivor. A comment that moves in a merge keeps
what it named, and its records then name the survivor in `from`. A description
stays on its item, so its records go on naming the merged item.

### Questions and decisions

`create_work_item_request` creates a persistent question or decision for one work
item. `get_work_item_request` and `list_work_item_requests` are read-only tools.
The answer, decline and expire tools take the request's own `expected_revision`;
it is independent of the work item revision. Only one concurrent resolution can
succeed. An ended bound execution or elapsed deadline prevents a late answer,
and so does the end of the session a request was
[asked of](#a-question-asked-of-an-agent-session); those are read, not written, and
reading effective expiry does not write to an attached store. A close of the item
ends the request in its own write ([closing](#a-close-ends-the-claims)), and a
closed item takes no new request.

A request record says why one ended unanswered in `expired_reason`: `deadline`,
`withdrawn`, `execution_closed`, `item_completed`, `item_cancelled`, or the
`session_gone` that is only read; `null` otherwise. `purpose` names what the owner's
answer carries out -- `review`, `confirm` or `return` -- and is `null` on every
other request. The compact form of `get_work_item`'s `questions` carries each of
the two only where it is set.

Fields have stable IDs and one of five types: `text`, `choice`, `multi_choice`,
`boolean` or `verdict`. A required boolean can be answered `false`; omission is
different. There is no implicit permission grant or automatic execution resume.

A field is `{id, label, type, required, options}` and may add five keys:

| Key | Value | Rule |
| --- | --- | --- |
| `description` | markdown of 1 to 8000 characters | on a field of any type: what the field asks, or the point it decides. The interface folds it as it folds an option's description |
| `group` | text of 1 to 200 characters | the fields of one group stand together, and the interface draws them as one section under that heading |
| `under` | `{field, option}` | the field is shown and answered only while the answer of `field` holds `option`; see below |
| `recommended` | `accept`, `later` or `reject` | on a `verdict` only; a `choice` and a `multi_choice` recommend on their options |
| `why` | markdown of 1 to 8000 characters | beside `recommended` only: why the asker recommends that verdict. The interface shows it where the person points at or focuses the recommendation |

A question holds 1 to 40 fields, a field at most 20 options, and the fields of one
question fit in 64 KiB as stored; a refusal names the limit. What a field or an
option was not given it does not say on the way back, and a question written
without the five keys is what it always was. The published schema of
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
  "why": "All fourteen were the same rule.",
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
  "options": [{"id": "per_block", "label": "vue/max-lines-per-block", "recommended": true,
               "why": "The rule already exists; no file moves."},
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
| `why` on a field without `recommended` | `field p4: why says why recommended; give recommended or leave why out` |
| `why` on an option not recommended | `option keep: why says why it is recommended; give recommended: true or leave why out` |
| a group split by another | `group Checks is split by Web code: fields of one group stand together` |
| more than 40 fields | `fields must contain between 1 and 40 fields` |
| a key a field does not take, or one it requires missing | `each field requires id, label, type, required and options and may add description, group, under, recommended and why; one field: {"id": "scope", "label": "Scope", "type": "choice", "required": true, "options": [{"id": "small", "label": "Small"}, {"id": "full", "label": "Full"}]}` |
| a field or option id that is not a lowercase identifier | `field and option ids must be stable lowercase identifiers (a-z first, then a-z, 0-9, _ or -; at most 64), as in {"id": "scope", …}`, with the same field in full |

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

An option is `{id, label, description?, recommended?, why?}` and takes no other key.
`description` is markdown of 1 to 8000 characters and `recommended` a boolean, true
on at most one option of a `choice` and on any number of a `multi_choice`. `why` is
markdown of 1 to 8000 characters on an option whose `recommended` is true, and
nowhere else: why the asker recommends it. A list under a comment takes the same
option.

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
{"data_scope_id": "…", "space_key": "MAIN",
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
1500 characters: rows that do not fit are left out from the end and counted, as
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

- The `questions` part of `get_work_item`, which the card counts in its `parts`
  as `count`, `open` and `addressed_open`:
  `{"total": 6, "open": 2, "items": […], "truncated": true, "addressed_open": 0}`.
  At most 5 items, the open ones first and then the newest closed. A request asked
  of an agent session is none of them and counts in none of the numbers but
  `addressed_open`, the open ones. The full record of the HTTP read has no such
  key; an HTTP read that names the part does.
- `list_work_item_requests` takes `space`, `id` (one item), `status`,
  `answered_after`, `limit`, `offset` and `addressed`, and answers in the compact
  form below, or whole with `full: true`. It leaves out every request asked of an
  agent session, unless `addressed: true`: then it lists only the open requests
  asked of the session of the call, and refuses a call that proved none. Its page
  says `truncated` and `next_offset` as every list does. `answered_after` keeps only
  answers given after that timestamp, oldest first by `answered_at` and then by id,
  so a reader takes what came since by passing the last `answered_at` it read and
  asking again while `truncated` is true. A page never ends between two answers of
  one time: it runs past `limit` by the tie, because the next page starts after that
  time. Without `answered_after` the newest question comes first.
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

The browser's mapped search and request endpoints read every space of the
primary store and of each attached store, and every space the registry binds a
project to that cannot be read; a space with no project is read like any other.
Each result names its exact Planning space in `target.space_ref`, and each source
of the coverage is one space, by `space_ref`. Their list envelopes include source
coverage and a truncation flag. A source that was not read says why in `reason`,
as one stable code: `store_not_attached` (a project's space lives in a store this
server neither owns nor has attached), `store_unreadable` (an attached store could
not be opened), `attached_list_unreadable` (the list of attached stores could not
be read), `space_missing` (the store holds no such space), `search_failed` (the
store opened but the search failed there) or `requests_unavailable` (an attached
store predates human requests). The exact reads and writes name one space by
`scope_kind=space` with `data_scope_id` and `space_key`; a read may narrow it with
`project_id`, a project of the space or one its items name: a project the
registry does not hold is 404, and a registered one that is neither is 409. The
mapped search answers the item a reference query names first, the primary
store's ahead of an attached store's, before it cuts the page; a query that is a number alone answers each source's item of that number
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

**Writing one.** The `comment` and `summary` groups of
`apply_work_item_changes` and each comment where a batch writes several take
`list`, and so do the HTTP writes of a comment, a report and the summary:

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
| a list in a call that closes the item | `transition: a list on an item this call closes would end unticked in the same write: write it in a call that leaves the item open`, on the `transition` step |

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
`<label>: not decided`, as does the notice of a change that unticks everything,
before the ids it removed. A person's answer is a
`question_answered` event: the agent that wrote the list and the item's holders
hear it, as for any question (see
[the hook contract](hook-contract.md#who-is-told)), and the next agent write
carries it in `from_person`. Changing it is changing an answer.

**Close and reopen.** The close of its item ends a pending list as it ends any
pending question there: `expired`, with `expired_reason` `item_completed` or
`item_cancelled`, and reopening the item leaves it so. An answered list on a closed
item cannot be changed (`[item_closed]`); once the item reopens it can. The
interface keeps ticks not yet sent in view and says that the item is closed and the
ticks reach nobody. An agent that wants the ticks keeps the item open until they
come.

**Merging.** A list goes with its comment: a comment root's list moves to the
survivor with it, and a report's list stays with the report on the merged item. A
comment is deleted only with its item, and its list with it.

### A question asked of an agent session

A request can ask one top-level agent session instead of the owner: its record
names that session in `addressee`, which is `null` on a question to the owner.
Several sessions asked one question get one request each, written in one call, with
the fields of any question. A session asked must be known, live, a top-level one rather than a subagent's, and
not the caller's own; one that is not is refused with `invalid_request`, naming
the session, and nothing is written.

**How an agent asks.** `create_work_item_request` with `addressees`, a list of 1 to
5 top-level session ids, as `participants`, `subscribers` and holders name them,
asks those sessions instead of the owner: one request each, in one write, with the
`kind`, `prompt`, `fields` and `expires_at` of the call. The session that asked is
the one the call proved, whichever of its agents made it. The answer names each
request and the session it asks:

```json
{"requests": [{"request_id": "…", "addressee": "019a3c2e-…"}]}
```

The interface writes through the same route
(`POST /api/planning/work-item/request`) and is refused like any call that proved
no agent session. Refused before anything is written, the message naming the
session where there is one:

| Case | Refusal |
| --- | --- |
| a call that proved no agent session, the interface's or an unconfirmed one | `invalid_request` |
| a session that is not known, has ended or has been quiet longer than a lease lasts | `invalid_request`, naming the session |
| the caller's own session, or a subagent's rather than a top-level one | `invalid_request`, naming the session |
| a session named twice, more than 5, or none | `invalid_request` |
| `execution_id` or `session_id` beside `addressees`: those bind a question to the owner | `invalid_request` |
| a closed item | `invalid_request`, as for any request |
| a fourth request from one session to one other within an hour | `ask_limit` (429): `session <id> was asked 3 times in the last hour by this session; write once there, or wait` |

The hour counts the requests asked of that session whose confirmed call names the
asking session, its subagents included; a refused call asked nothing and counts
toward no hour, and Valkama's own requests count toward none. The batch's
`questions` take `addressees` as well: an entry with them asks those sessions in the
same write as the batch's other groups and answers with `requests`, as above. A
refused entry refuses the whole batch and writes nothing of it.

**Who answers.** Only a call whose session a client proved and that is the
`addressee` answers it, changes the answer or declines it, from that session's
conversation or any of its subagents. Only the session that asked, from any of its
agents, or Valkama withdraws it with `expire_work_item_request`:

| Case | Refusal |
| --- | --- |
| an answer, a change or a decline from any other caller, the interface included | `not_addressed` (403) |
| a withdrawal by anyone but the session that asked or Valkama | `not_asker` (403) |

**When the session is gone.** While the `addressee` has ended, or has been quiet
longer than a lease lasts, the request reads `expired` with
`expired_reason: session_gone`, from the moment the session ends and with no grace,
and an answer is refused as on any expired request. Nothing is written: when the
session resumes, the request waits for its answer again. A deadline (`expires_at`)
is what gives one a stored end.

**What it does not do.** It is no question to the owner: it raises no Windows
notification and takes none back, it is not in
[the panel of open questions](#the-panel-of-open-questions) or any count of what
waits for the owner, it holds nothing up, and a merge moves it with the work but
does not say it waits on the survivor. `GET /api/modules/planning/requests`,
`list_work_item_requests` without `addressed` and `get_work_item`'s `questions`
leave it out; `get_work_item_request`, a read by its id, and an export read it as
any request.

**Who is told.** Where Valkama's client hooks are installed, the asking wakes the
session asked, and what becomes of the request reaches that session and the one that
asked, nobody else: see
[asked of a session](hook-contract.md#asked-of-a-session). That news is told
once; while a request still waits, the session asked finds its item again in the
line `Waiting for your answer: …` of its
[resume note](hook-contract.md#the-resume-note) after a resume or a compaction,
and none of its subagents does.

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

A new history action is such a change. The set of actions is closed three
times over: by the `CHECK` of the store's event table, by the interface's strict
reader of a card, and by this contract. A build that does not know an action
refuses the whole card of an item whose history holds it. Schema 15 is the step
that added `labels_changed`: a store at 14 is opened by taking a verified
snapshot labelled `preschema15` and then rebuilding the event table under the
wider `CHECK`, every event kept with its id (a store at 13 takes both steps in
one open under `preschema14`). A store already at 15 opens without either. A
build of the previous release, at schema 14, refuses a store at 15 with
`StoreTooNew` and leaves it untouched rather than show cards it would refuse;
going back to it means restoring the `preschema15` snapshot with its pictures
(see [Restoring a snapshot](guides/store-upgrades.md#restoring-a-snapshot)), which
loses everything written since.
