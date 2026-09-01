---
status: adopted
card: 261, 351
---

# Valkama Kernel contract

The [product model](product-model.md) owns Valkama's vocabulary. This document
owns the two UI operating levels, module semantics on each level, and the exact
records the Kernel may not confuse. `OperatingScope` is a required route
discriminant and is validated on every Kernel request.

## Operating levels

`Global` is the portfolio and governance workspace; it may inspect aggregates
and manage project-owned records, but it is never a wildcard permission or a
pseudo-project named `all`. `Project(ProjectRef)` is the bounded workspace for
one exact project. Every module declares its semantics for both levels (or a
typed unsupported state) in its manifest; switching modules never silently
changes the level.

| Module | Global | Project |
| --- | --- | --- |
| Planning | Portfolio of Planning spaces and their work; its current Kanban storage uses Planning-specific boards/cards | Views and actions for the exact ProjectRef; current Kanban writes require an exact Planning BoardRef |
| Sessions | Fleet, attention, and unlinked execution | Only execution with an exact stored project relation |
| Improvements | Cross-scope signals and unassigned items | Signals and planning targets linked to the exact project |
| Analytics | Portfolio metrics and explicit project drill-down | Metrics and evidence for the exact project |
| Settings | Modules, adapters, services, installation assignments/connections/grants, and system settings | Project overrides, connections, grants, bindings, and project-owned settings |
| Skills | Shared definitions plus the assignment/activation matrix | Applicability, source, and activation for the exact project |

All modules use the same state grammar: `loading`, `ready`, `empty`,
`degraded`, `unavailable`, `permission-denied`, and `error`. A state is not
inferred from another state (for example, no events do not mean disabled), and
recovery explains the owning boundary and next action.

## Four object kinds that are not each other

- Definitions declare what exists (`ModuleDefinition`, `AdapterManifest`,
  `ServiceDescriptor`, and `SkillDefinition`); they do not enable or authorize
  it.
- `ConnectionRef` identifies one provider instance and owns applicability,
  health, and bounded diagnostics. Connections never become permissions.
- An Assignment explicitly selects Connection references for one Capability at
  `installation` or one exact `project`. Registration alone creates no
  assignment, and an assignment alone grants no permission.
- `PermissionGrant` is a separate, scoped, backend-enforced authorization. A
  Global grant does not expand to Projects; a Project grant is exact.

## Routes and extension points

The clean-start route is owned only by the Kernel shell and stable module IDs.
`OperatingScope` is a required route discriminant; module-local filters and
typed `EntityRef`/secondary context remain inside that module's route schema.
Adapters and packages contribute provenance and actions but never create route
namespaces. Unknown routes resolve to a recoverable unavailable state. The
route is clean-start: old query keys, localStorage navigation state, and
invented legacy aliases are not read, translated, or dual-owned.

Extensibility stops at named, validated contribution slots: relation resolver,
typed entity action, declarative inspector/status, normalized event source,
bounded read model, and settings/connection entry. Adapter execution is
backend-only and returns validated payloads with provenance. An adapter cannot
ship arbitrary Vue components, HTML, JavaScript, browser code, paths, secrets,
or commands; a full route/workspace requires a separately declared module.
Core consumers request contributions by slot and `EntityRef`, never by a
provider-specific branch or hard-coded adapter ID.

## Relations and project membership

The relation lens is generic: module entities retain canonical identity, while
a relation row carries `EntityRef`, `ConnectionRef`, adapter lineage, resource
identity, resolution state, and typed `ActionRef[]`. Disabling or removing an
adapter leaves the pointer and shows `unavailable`; it does not delete provider
data or rewrite populated refs. `kind=memory` is a Kernel pointer binding, not
a special provider UI.

Planning project membership is never guessed from a board name, cwd, title,
label, filter, or data scope. A current Kanban action must prove
`ProjectResourceBinding.resource_ref → PlanningSpace EntityRef → BoardRef`;
the BoardRef decoding is confined to the Planning implementation rather than
shared Kernel identity. Unbound, ambiguous, stale, detached, and same-store/cross-project
targets fail closed. Unlinked sessions and resources remain Global/orphan until
the user confirms an exact relation.
Global governance actions show `view_scope=Global` and carry a separate exact
`invocation_scope=ProjectRef`; both scopes are audited. Existing Planning
cards, refs, claims, history, and provider pointers remain system of record,
while removed UI/routes are not preserved as a compatibility layer.
