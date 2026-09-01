---
status: adopted
card: 351
---

<!-- kb:core-001-product-model -->

# Valkama product model

Valkama is a local, single-user, modular control surface for agent work and the
tools that support it. Planning is one Valkama module. Kanban is one Planning
view; neither a board nor a card is a product-wide Kernel entity.

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

The persisted server registry is the only runtime authority for built-in and
future modules. `GET /api/modules` returns every registration with its manifest,
enablement state, mutability, revision, and update time. Navigation and routing
consume that validated response. Settings is always enabled and cannot be
disabled. Planning and Sessions are enabled on first installation; optional
modules may be disabled without deleting their data. A disabled module has no
navigation entry and its direct route yields typed recovery UI; it cannot run
module actions or background work until it is enabled again.

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
- Skill display names are not durable identities; Valkama owns installation
  identity and retains the provider/source locator.

## Example composition

Planning is a Module; Kanban is one of its Views. Claude Code and Codex are
Adapters that can expose execution and telemetry Capabilities through separate
Connections. A Project Assignment can select a Claude journal Connection for
telemetry while another Project selects a Codex rollout Connection, without
changing either Module.
