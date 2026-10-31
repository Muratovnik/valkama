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
across Planning spaces also fails as ambiguous. An observed session directory
never grants root authority: native opening resolves the exact Planning-space
binding again through the project registry. Missing, malformed, unavailable, or
ambiguous bindings cannot supply an effective project root. Session refs, native
opening, and execution launch, stop, resume, history, and typed results remain
supported.

Memory reads through its own provider API. A work item keeps a typed `memory`
pointer and its stored label, including when the provider is unavailable. Retiring
the Skills catalogue does not alter installed skill files or client enablement.
