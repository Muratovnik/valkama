---
status: adopted
card: 351
---

<!-- kb:core-001-product-model -->

# Valkama product model

Valkama is a local, single-user workspace for project work: plan an item, claim
it, settle blockers, execute it, and record a result for review. The Work
destination presents Planning through board, list, and graph views of one read
model. Settings is the other navigation destination. Memory references and exact
session context are part of a work item.

## Vocabulary

| Term | Meaning |
| --- | --- |
| Kernel | The small product core that owns module discovery, routing, operating scopes, the external adapter contract, normalized projections, security, and diagnostics. |
| Module | A user-facing domain with its own route namespace, entities, actions, and lifecycle. |
| View | A presentation of one module's entities. It owns neither domain data nor integrations. |
| Adapter | Code that answers one or more Capabilities for a concrete built-in or external tool. An external Adapter declares itself in a four-field manifest and is reached through a transport its owner supplies. It owns no product route. |
| Capability | A named operation, a dotted lowercase id such as `memory.open`, that an Adapter declares it answers. |
| Projection | A normalized Valkama read model. Provider-native payloads do not cross directly into product UI. |
| Project | A stable user project identity and its root, independent of a Planning representation. |
| PlanningSpace | A planning namespace within a Project. |
| Workflow | A set of WorkItem states and permitted transitions. |
| WorkItem | A unit of planned work. |
| Execution | One attempt to perform a WorkItem. |
| Session | One exact provider-client session that may participate in an Execution. |

Service, Connection, Assignment and permission grant named the records of the
extension registry, which has been removed;
[ADR 0010](decisions/0010-coordination-from-session-identity.md) records
why. None of them is a current product record.

## Load-bearing distinctions

| Concern | Module | View | Adapter |
| --- | --- | --- | --- |
| Owns a user domain and route | Yes | No | No |
| Presents module entities | Through its views | Yes | No |
| Owns domain data | Yes | No | No |
| Implements external or built-in capabilities | Requests them | No | Yes |

An adapter manifest names the adapter and the Capabilities it answers; the
owner supplies where it is reached. Declaring an adapter enables nothing and
authorizes nothing.

A WorkItem expresses intent, an Execution records one attempt, and a Session is
the provider's exact conversational/runtime container. One WorkItem can have
many Executions, and one Execution can correlate with more than one Session.

## Adapters and capabilities

An external Adapter's manifest has exactly four fields: the contract it speaks,
its identity, its version, and the Capabilities it answers. A field the
contract does not name is refused rather than ignored. Where the adapter runs
is the owner's transport record, never part of the manifest; the
[README](../README.md#external-adapters) describes the calls and the checks.

A Module uses the provider it is built with: Memory answers through its
built-in Markdown provider for each registered project. No module selects among
installed adapters. A call for a Capability the adapter did not declare is
refused before it leaves, and a call that cannot reach the adapter fails with a
typed error naming the cause. Asked for its health, an adapter that cannot be
reached reads as a typed unavailable result with a diagnostic, never as an
exception or a silent absence.

## Module list

The server declares `planning`, `memory`, and `settings` in its code, and that
list is the whole answer: no store row records it and nothing changes it at
runtime. `GET /api/modules` and the MCP tool `list_platform_modules` return
each module's manifest inside a registration that keeps the wire's `state`,
`mutable`, `revision`, and `updated_at` fields; every module is `enabled`, none
is `mutable`, and `updated_at` is when the list last changed. Memory
contributes references inside work-item context rather than a standalone
navigation destination. Analytics, Improvements, Skills, and standalone Sessions
registrations, pages, and APIs are retired.

A store does not record the list. Store schema 9 dropped the
`platform_modules` rows an earlier build wrote, their audit in
`platform_registry_audit`, and the extension registry's tables; the snapshot
taken before that migration still holds them.

The semantic interface identifier remains `valkama-modules`. The payload is cut
over atomically across server, validators, UI, tests, and built artifacts; no
numbered parallel contract is introduced. `STORE_SCHEMA_VERSION` is only the
technical store-generation guard.

## Invariants

- There is one current domain and storage model. Durable data crosses a model
  change through a verified snapshot and one-shot migration, never dual read,
  dual write, aliases, or a compatibility facade.
- Existing MCP tool names and input schemas remain an external transport
  boundary where repository policy requires them. Their implementation
  translates directly into the sole current domain model.
- Product interface identifiers describe semantics and never gain numbered
  generation suffixes.
- `Board` and `Card` are valid only inside Planning-specific storage, adapters,
  views, migration fixtures, and the legacy MCP wire translator.
- Provider-native payloads terminate at their Adapter. UI reads normalized
  Valkama projections with provenance and bounded diagnostics.
- Session identity comes from the client, not from the agent. A lifecycle
  event takes its session from the hook input; an MCP write takes it from the
  call — Codex `_meta.sessionId` and `_meta.threadId`, or an `_identity`
  argument a Claude Code `PreToolUse` hook adds, which the server removes
  before schema validation. A write without verifiable identity is accepted
  and marked `unconfirmed`. The MCP server's process environment and
  free-text author strings are never identity; OTel remains an observational
  feed.

## Work-item context

Historical session events remain stored; retiring the monitor does not erase
that history. New ingestion is lifecycle-only.

Planning owns session lifecycle ingestion and compact context resolution.
`POST /api/ingest` accepts only `session_start`, `session_end`, `attention`, and
`turn_end`. The request is a UTF-8 JSON object with required string fields
`session_id`, `client`, and `event`. Optional fields are `cwd`, `label`,
`status`, `detail`, and an exact `work_item` reference. `session_start` opens
or resumes the session; `session_end` records `ended` or `failed`;
`turn_end` records waiting without ending the session; `attention` records a
lifecycle attention reason. A failed terminal outcome remains until an explicit
new start. The installation bearer and loopback requirements are documented in
the [README](../README.md#local-http-security).

`GET /api/session?id=<id>` resolves an exact stored identity or unique prefix
and returns its work item, client family, and project-root resolution; it exposes
no event feed. Missing or ambiguous identities fail resolution. A session linked
across Planning spaces also fails as ambiguous. A session's folder never grants
access to files: a file or folder opens only inside a project the registry holds,
and a session opens in the folder it last started in, its `cwd` or its space's
root, only when that is an existing absolute local folder. Session refs, native
opening, and execution launch, stop, resume, history, and typed results remain
supported.

A work item's card lists the agents on the item, and only Claude Code's for now. The
list is `agents` in `GET /api/modules/planning/work-item`; no MCP tool answer carries
it. Nothing records which item an agent serves, so the link is worked out on each
read, and the row says which kind it is:

- **Exact** (`link: "exact"`): the agent's own confirmed call wrote to this item or
  holds one of its steps.
- **By the coordinator's claim** (`link: "claim"`): the session that started the agent
  held this item at that moment, by its own confirmed claim. A session holding several
  items puts the agent on each of them, and `coordinator_items` says how many it held,
  because nothing shows which of them the agent was started for. An agent that wrote to
  any item stands only where it wrote, since that does show it.

An agent that wrote nothing, whose parent session held nothing when it started, is on
no card. Neither is an agent Claude Code ran for its own purposes, such as a prompt
suggestion: those report a stop and no start.

A row gives what was recorded and no more. `last_activity_at` is the last sign Valkama
saw: the agent's start, a hook event inside it, or its write to Planning. While an agent
has no recorded end, it also takes the time its transcript file was last written, read
each time the card is read. Only the file's time is read, never its content, and a file
that is not there adds nothing. An agent's other tool calls reach no hook here, so an
agent whose transcript Valkama cannot find shows the last of those signs. `ended_at` is
set only by a recorded end, and an agent cut off by a client
restart leaves none, so a row with no end does not mean the agent is running. Valkama
does not know how much work remains. `label` comes from
[the hook contract](hook-contract.md#naming-an-agent), and an agent without one, as
every agent recorded before that hook has, is shown by its type and short id.

The planning event stream sends a short `agents` event when anything is recorded about
an agent, so an open card reads its list again without a frame of the whole space.

The same read gives the claim, each step and each agent an `executor`: `session`, the
session a click on that holder would open, which for an agent is its parent because a
subagent cannot be opened from outside; `agent`; `opened_in` and `opened_host`, where
that session was last opened, empty when unknown; `family`, whose settings cover it
(`claude`, `codex` or `other`, empty for `none`); and `state`. The record itself
carries `last_claim_executor`, the same for the holder `last_claim_ref` names, since
a close ends the claim and that holder may be the one to resume. No MCP tool answer
carries any of them. The state is what the record shows:

- `none`: no session to open. A person or the browser holds it, nobody does, or the
  holder's label replaced a long session id with its digest. Every other field is empty.
- `live` and `headless`: the session's row says active, and `headless` has no window to
  go to. A session Valkama itself launched counts as headless until a client places it.
  A client that crashed leaves its row active, so `live` does not prove a process.
- `ended`: the row says ended or failed.
- `gone`: ended, and the transcript file the client named is no longer there. Only the
  file's status is read, and a live session whose file is not written yet stays `live`.

**Live work on the space read model.** The space's read model (`GET /api/planning` and
its event stream) carries `live_work`: the items an agent is at work on now, by id, each
with a `state`. An item with no live work is not in the map, and no MCP tool answer
carries it. The sessions behind an item are the one whose confirmed call took its claim
and the ones its open steps' holders name; a subagent's claim or step names its parent's
session. A session counts while its row says active and its last sign of life is no older
than a claim's lease, fourteen days.

A session is at work when a turn of its own runs, or when it has a live subagent: active,
started since the session last really started, and with a transcript written within two
hours. Where no such file can be read, only a day since its start stops it. A compacted
context is reported as a session start and is no such thing: the client runs on with its
turn and its subagents.

A turn of its own runs when a prompt is the last of the session's events that open or end
a turn (a start, a prompt, the end of a turn, the end of the session) and its client is
seen alive: the later of its last event and the time its transcript was last written is
within fifteen minutes. A notice that the client waits for a person stops the turn until
the transcript is written again after it, which is the answer arriving. Where no
transcript can be read, a turn runs while a prompt is its last event, and a notice stops
it until the next prompt. Then:

- `working`: a session at work is seen working on this item, whether or not it holds it.
  A session whose own turn runs stands on one item: among the items it holds, the one its
  own Planning write named last (a claim, a step, a comment, a link, which names its source
  item); holding none, the one it wrote to since its last prompt. A live subagent of a
  session at work is on the item it wrote to since it last started, holds an open step of,
  or was launched with a description or a packet that names its number; with no such sign
  it is on the one item its session holds, and on none when the session holds several. An
  attempt Valkama runs on the item, starting or running, is `working` with no session.
- `held`: the session is at work, but not on this item as far as the record shows. A
  session holding several items moves only the one it stands on and those its subagents
  are on.
- `waiting`: any other live session. Its turn ended, it waits for a person, it fell silent
  in the middle of a turn, or it was opened or resumed with no prompt yet. It carries
  `long`, true once the session has been silent for more than four hours, which a view
  may fold away, and `asks`, true while a notice stands in the session's open turn: it
  stopped in the middle of its work for a permission or an answer, which is not the wait
  of a session whose turn is over.
- `quiet`: no sign of life for more than a day, with `quiet_since`, the last one. A
  silent session is not called ended: silence proves nothing.

An item takes the strongest of its sessions and attempts, `working` before `held` before
`waiting` before a long `waiting` before `quiet`, and a session that asks before one of
the same wait that does not. Only `quiet` carries a time, and `long` turns once, so the
stream writes a frame when a state changes, not on every event. What
the map cannot see: a client that died in the middle of a turn reads as at work for
fifteen minutes more, and one step of a turn that writes nothing for longer reads
`waiting` until it writes. A session that went on to another item it holds stands on the
one before until it writes to the new one, and a session whose turn has ended puts
nothing in the map for an item it only wrote to. A store an earlier build wrote, without
the columns the map is read from, gives an empty map.

**Opening the executor** is the action a holder offers. A press asks the server for a
plan (`GET /api/open-plan`, described in
[What a click opens](connection-contract.md#what-a-click-opens)) and opens the session
where it was last open: the Claude Code extension in its IDE, Claude Desktop, the Codex
app or a terminal, then the owner's fallback place and VS Code when that place is
unknown or not installed, unless the owner set one place to always open in. A Codex
session last open in the IDE extension opens in the Codex app, because the extension's
route has not been seen working yet. A subagent opens through its parent. A session
live in a terminal is not started a second time, a session the client no longer keeps
is not opened at all, and the plan says why instead. The desktop app runs the plan's
steps; a browser follows one per press. Apart from a command of the owner's own, which
the app runs as set, neither the page nor the app decides where a session goes.

Memory reads through its own provider API. A work item keeps a typed `memory`
pointer and its stored label, including when the provider is unavailable. Retiring
the Skills catalogue does not alter installed skill files or client enablement.
