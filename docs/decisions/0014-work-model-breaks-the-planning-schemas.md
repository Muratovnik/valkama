---
status: draft
---

# ADR 0014: The work model breaks the planning schemas and the handshake once

This record covers the one break of Valkama 3.0: the work model (decisions 1
to 3), the spaces and projects that come with it (decision 4), and reading a
work item by parts (its own section below).

## Context

Valkama keeps the MCP handshake and the tool schemas its clients already use:
an agent's client caches them at startup, and the Valkama skill and the web app
are written against them. A change there is normally additive.

Valkama 3.0 changes what a work item is. An item was a task or an epic, an
epic being an item that other items named as parent, one level deep, and it
stood in one of seven categories with `backlog` and `queued` among them. In 3.0
an item is a task, a bug, an improvement, a goal or a stage; goals and stages
hold other work at any depth and are never claimed; there are eight categories;
work is accepted on a recorded basis; and an accepted open goal or stage shows
what it derives from the work under it instead of a state. The order work is
taken in was set by hand, a `rank` stored as the item's `position`; in 3.0 it is
computed from the work model. The store moves to schema 18 through
`valkama migrate work-model`.

Several of the old names would mean something else under the new model. A
`ready` field beside a `ready` category reads as a contradiction (`category:
ready`, `ready: false`), `scope=epic` read only the children where the new
scope reads every level, and `backlog` named both a category and the default
key of a state that no longer exists. Keeping the old names as aliases is what
this repository refuses everywhere else: one runtime schema, no dual reading
and no compatibility layer.

## Decision

1. **The planning schemas and the handshake break once, in 3.0.** What breaks
   is the work model and nothing else:
   - `kind` takes and shows `task`, `bug`, `improvement`, `goal` and `stage`;
   - the categories are `triage`, `deferred`, `ready`, `active`, `review`,
     `completed`, `blocked` and `cancelled`;
   - an item record loses `container` and `ready`, gains `open`,
     `container_state`, `acceptance`, `started_at`, `waits_for` and `workable`,
     and has `state: null` exactly when it is an accepted open goal or stage;
   - the chain and usage scope `epic` becomes `tree`;
   - `create_work_item` and the `transition` group take `acceptance`;
   - the order of work is computed: the `update` and `transition` groups and
     their HTTP writes lose `rank`, the store loses `position`, a chain member
     loses `rank` and the members come in the order of work;
   - a row of a list read and a chain member carry `queue_order`, their place
     in the space's queue; an item record carries `withheld`, why the queue does
     not give it, and `lapsed_claim`, the holder whose claim the sweep released;
     a checklist step carries `by_previous_holder`;
   - `claim_ready_work_item` reads one space's queue: `space`, or the space of
     a goal or stage named in `within`, which keeps the tasks under it, or the
     space whose project root holds the calling session's folder; `label`
     keeps the tasks that carry that label, and `project` the tasks that name
     that project, never a task that names none; a call with no such space is
     refused;
   - in a read of one space, an item of another space that names one of its
     projects carries `outside_space` in `withheld`: that space's queue does
     not give it;
   - a commit is attached to an item rather than written as a ref: the `refs`
     group and `POST /api/planning/work-item/ref` refuse the kind `commit`,
     naming the `commits` group, an item record's `refs` holds no commit, and
     `GET /api/ref` refuses `kind=commit` and no longer reads `space`, which
     only chose the repositories a commit was looked for in;
     `GET /api/commit?repository=<id>&hash=<hash>` shows an attached commit
     from its project's repository instead, and the handshake says that
     Valkama attaches the commits a session makes;
   - the handshake text describes this model.

   Every other tool, argument and answer field stays as it was, apart from
   what decision 4 lists and what
   [Reading a work item by parts](#reading-a-work-item-by-parts) changes in the
   same release.

2. **A retired word is refused, never translated.** `kind: epic`,
   `scope: epic`, the categories and state names `backlog` and `queued`, the key
   `todo`, the store's own `container` and the field `rank` are refused with
   `invalid_request` on every input that took them, before anything is written.
   The refusal names what replaces the word: `kind epic is retired: a container
   is kind goal, or stage under a parent`, `backlog is now triage`, `rank is
   retired: the order of work is computed — urgent, started, a goal or stage
   under way, priority, age`. One list in the planning
   model holds the words, and every refusal, from MCP or HTTP, reads it.

3. **The break ships with what reads it.** The skill Valkama installs, the web
   app's contract layer and the connection contract change in the same release,
   and a test fails when a tool schema, the handshake or a page of the skill
   names a retired word.

4. **Spaces and projects break in the same release.** In 3.0 a planning
   space holds any number of projects, one of them its default, and the
   project registry is where that is written; a space no longer belongs to
   one project. What breaks with it:
   - the project registry: the inventory goes to format 2 and its projection
     to format 4, where a binding carries `default` and several projects may
     bind one space, each bound space with exactly one default project;
   - `create_planning_space` takes no `project_id`, and a space record has no
     `project_id`;
   - `space` on `create_work_item` is optional;
   - the scope `project` becomes `space`, with the project an optional
     refinement of it, and the module levels are `global` and `space`.

   The rule for a format is one way: the former reader refuses the new format,
   and the new reader does not read the former one. A 2.9 build reads a format-4
   projection as malformed and a 3.0 build reads a format-3 one the same way.
   Only `valkama projects upgrade`, which carries a registry across and keeps its
   former bytes once for `valkama projects downgrade`, and `valkama projects
   import`, which takes a former writer's inventory of format 1, read the former
   format, through one reader and one translation. What is kept is three files —
   the inventory, the projection and the one-write snapshot `rollback` restores
   from — each with its SHA-256 or recorded as absent; an import onto a machine
   with no registry keeps that absence the same way.

## What a client does instead

| Before 3.0 | From 3.0 |
| --- | --- |
| `kind: "epic"` | `kind: "goal"`, or `"stage"` under a parent |
| an item is a parent when another names it | `kind` is `goal` or `stage` |
| `container` | `kind` |
| `ready` | `workable` |
| `state.is_terminal` to tell an open item | `open` |
| the category of a parent's state | `container_state` when `state` is `null` |
| `category: "backlog"`, `"queued"` | `"triage"`, `"ready"` |
| state key `todo` | `ready` |
| `scope: "epic"` | `scope: "tree"` |
| creating work an agent was asked for | `acceptance: "assignment"` |
| `rank` to place an item | nothing: the order of work is computed |
| a chain member's `rank` | the members' order, and `queue_order` |
| `claim_ready_work_item` with no `space`, taking from every space | `space`, or `within` naming a goal or stage, or else the space of the session's project root |
| a registry projection of `schema_version: 3` | `4`, after `valkama projects upgrade` |
| one project binds a space | each binding says `default`; a space has one default project |
| `create_planning_space` with `project_id` | `{name, key}`; `valkama projects bind` joins a project |
| scope `project` | scope `space`, the project an optional refinement |
| `refs: [{"kind": "commit", "value": "…"}]` | `commits: [{"repository": "<project id>", "hash": "…"}]` |
| a card's commits among its `refs` | its `commits` |
| `GET /api/ref?kind=commit&value=…&space=…` | `GET /api/commit?repository=<project id>&hash=…` |

## Consequences

- Every session restarts after the 3.0 install: a running client keeps the
  schemas, the handshake and the skill it read at startup.
- A client written against 2.9 reads a 3.0 answer wrongly or is refused; a 3.0
  answer has no field that means what `ready` or `container` meant. The web app
  and the server therefore ship together.
- The exception is closed past what this record lists and closes with the 3.0
  release. A later change to the handshake or the schemas meets the usual rule
  again, and the retired words stay refused, not reused.
- Rollback is the whole set: the store from the `pre3.0` recovery point, the
  registry from `valkama projects downgrade` and the previous release together.
  The registry is returned before the previous release is installed, because a
  2.9 build has no `downgrade` and its `rollback` refuses a format-4 snapshot;
  `downgrade` puts back the one-write snapshot the upgrade found, so that
  `rollback` of the previous release undoes its own last write again.
- Rejected: aliases from the old words to the new ones (two spellings of one
  contract, and a dual reading the store rule forbids); keeping `ready` and
  `container` beside the new fields (a field that contradicts the category it
  stands next to); and a second, versioned set of tools (two catalogues an agent
  must choose between, each with its own skill).

## Reading a work item by parts

### Context

A full record carries every comment, event, link, reference and session an
item has gathered. An agent that only needs the item itself pays for all of it
on every read, and the longest-lived items cost the most: the longest
discussion alone runs to hundreds of thousands of characters, which no single
answer holds. A switch between the full record and a short one does not help, because
the agent cannot tell what the short one leaves out until it reads the full one.

### Decision

1. **`get_work_item` answers with the card.** The card holds the record's own
   fields, the description, the checklist with each step's `id`, the summary,
   and `parts`: every other part of the item by name, with its count and size.
   The text the author wrote comes whole; what the server adds is bounded.
2. **A caller asks for parts by name.** `parts` names what the answer holds,
   beside the item's `reference` and `revision`: `card`, `comments`, `events`, `links`, `refs`, `questions`,
   `mentions`, `sessions`, `images`, `subscribers`, `claim` and `sections`.
   Each part carries the name of the full record's field it comes from:
   `comments` and `events` are read in slices, the other parts whole, as the
   full record held them. `sections` lists the sections of the description,
   and `section` reads one or more of them by key. The argument `full` is gone.
3. **Every MCP answer that gave the full record gives the card.** The
   `verbose` answer of a write and the `work_item` that
   `claim_ready_work_item` returns are the same card. Lists keep their rows,
   and the handshake text describes reading by parts.

### What a client does instead

| Before 3.0 | From 3.0 |
| --- | --- |
| `full: true` | `parts` naming what the work needs |
| the whole record by default | the card, and its `parts` to see what else there is |
| the whole description to refresh one passage | `section` with the passage's key |
| the full record in a `verbose` answer or from `claim_ready_work_item` | the card, and `get_work_item` with `parts` for the rest |

### Consequences

- An answer is as long as the work needs, and the card says what it left out,
  so an agent never reads blind.
- A client that sends `full` is refused like any unknown argument: there is no
  alias that reads it as every part, for the same reason the work model keeps
  none.
- Over HTTP, a read without `parts` and every write answer still give the full
  record, so the web app reads as before. The skill, the connection contract
  and the handshake change in the same release.
