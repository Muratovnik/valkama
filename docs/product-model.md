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
| Kernel | The small product core that owns module discovery, routing, scopes, capabilities, Connections, Assignments, normalized projections, security, and diagnostics. |
| Module | A user-facing domain with its own route namespace, entities, actions, and lifecycle. |
| View | A presentation of one module's entities. It owns neither domain data nor integrations. |
| Adapter | Code that implements one or more Capabilities through a concrete built-in or external tool. It owns no product route. |
| Service | A tool or system for which Valkama can create Connections through an Adapter. |
| Connection | A configured, health-checked instance of a Service or built-in tool. |
| Capability | A typed operation requested by a Module and implemented by one or more Adapters. Its definition owns cardinality, permissions, and unavailable behavior. |
| Assignment | The explicit selection of Connections for one Capability at installation or project scope. |
| Projection | A normalized Valkama read model. Provider-native payloads do not cross directly into product UI. |
| Project | A stable user project identity and its root, independent of a Planning representation. |
| PlanningSpace | A planning namespace within a Project. |
| Workflow | A set of WorkItem states and permitted transitions. |
| WorkItem | A unit of planned work. |
| Execution | One attempt to perform a WorkItem. |
| Session | One exact provider-client session that may participate in an Execution. |

## Load-bearing distinctions

| Concern | Module | View | Adapter |
| --- | --- | --- | --- |
| Owns a user domain and route | Yes | No | No |
| Presents module entities | Through its views | Yes | No |
| Owns domain data | Yes | No | No |
| Implements external or built-in capabilities | Requests them | No | Yes |

A Capability definition describes what a Module needs. A Connection describes
one usable tool instance. An Assignment chooses Connection references for a
Capability. These records are not interchangeable.

A WorkItem expresses intent, an Execution records one attempt, and a Session is
the provider's exact conversational/runtime container. One WorkItem can have
many Executions, and one Execution can correlate with more than one Session.

## Kernel scope and resolution

Kernel contracts expose exactly two assignment scopes:

- `installation`: the local default;
- `project`: an explicit override keyed by stable `project_id`.

Resolution is deterministic: project override, then installation default, then
a typed unavailable result. Cardinality is enforced by the Capability; a
multi-source capability never silently selects a first Connection.

## Module registry and enablement

The persisted server registry declares `planning`, `memory`, and `settings`.
`GET /api/modules` returns their manifests, enablement state, mutability,
revision, and update time. Settings is always enabled and cannot be disabled.
Memory contributes references inside work-item context rather than a standalone
navigation destination. Analytics, Improvements, Skills, and standalone Sessions
registrations, pages, and APIs are retired.

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
- OTel and provider hooks are observational feeds, not authoritative session
  identity or lifecycle state.

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

Memory uses the existing provider and relation APIs. A work item keeps a typed
pointer and stored label, including when the provider is unavailable. Retiring
the Skills catalogue does not alter installed skill files or client enablement.
