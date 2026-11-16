---
status: draft
---

# ADR 0014: The work model breaks the planning schemas and the handshake once

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
     a goal or stage named in `within`, which keeps the tasks under it, and
     `label` keeps the tasks that carry that label; a call naming neither
     `space` nor `within` is refused;
   - the handshake text describes this model.

   Every other tool, argument and answer field stays as it was.

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
| `claim_ready_work_item` with no `space`, taking from every space | `space`, or `within` naming a goal or stage |

## Consequences

- Every session restarts after the 3.0 install: a running client keeps the
  schemas, the handshake and the skill it read at startup.
- A client written against 2.9 reads a 3.0 answer wrongly or is refused; a 3.0
  answer has no field that means what `ready` or `container` meant. The web app
  and the server therefore ship together.
- The exception is closed. A later change to the handshake or the schemas meets
  the usual rule again, and the retired words stay refused, not reused.
- Rollback is the whole set: the store from the `pre3.0` recovery point and the
  previous release together.
- Rejected: aliases from the old words to the new ones (two spellings of one
  contract, and a dual reading the store rule forbids); keeping `ready` and
  `container` beside the new fields (a field that contradicts the category it
  stands next to); and a second, versioned set of tools (two catalogues an agent
  must choose between, each with its own skill).
