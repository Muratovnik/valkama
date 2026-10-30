---
status: adopted
card: 261, 351, 1214
---

# Valkama Kernel contract

The [product model](product-model.md) owns Valkama's vocabulary. This document
owns the two UI operating levels, module semantics on each level, and what the
Kernel lets an adapter do. `OperatingScope` is a required route discriminant
and is validated on every Kernel request.

The shell exposes Work and Settings. The module list declares Planning, Memory,
and Settings; Memory contributes work-item references. Session lifecycle and
compact context are Planning-owned. Standalone Sessions, Analytics,
Improvements, and Skills destinations and their APIs are retired, and so is the
extension registry of services, connections, assignments, grants, actions and
relations. [ADR 0010](decisions/0010-coordination-from-session-identity.md),
still a draft, records why.

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
| Memory | The knowledge provider that answers for each registered project, and its health | Search and exact references linked to work items in the project |
| Settings | Language, module enablement, and installation health | The same installation settings; Settings holds nothing project-owned |

The Settings manifest persisted in the store still names the registry's read
models (`registry.*`, `project.assignments` and their kin). No endpoint serves
them; they leave when the module list moves into code.

All modules use the same state grammar: `loading`, `ready`, `empty`,
`degraded`, `unavailable`, `permission-denied`, and `error`. A state is not
inferred from another state (for example, no events do not mean disabled), and
recovery explains the owning boundary and next action.

## Definitions are not enablement

- A `ModuleDefinition` declares a module. Whether it is enabled is a separate
  persisted state; Settings is always enabled.
- An adapter manifest declares an external adapter: the contract it speaks,
  its identity, its version and the capabilities it answers — four fields and
  nothing else. The transport record, written by the owner, says where the
  adapter is reached. Neither enables anything or authorizes anything, and
  neither is published to the browser. The [README](../README.md#external-adapters)
  describes the three calls and the checks.

## Routes and adapters

The clean-start route is owned only by the Kernel shell and stable module IDs.
`OperatingScope` is a required route discriminant; module-local filters and
typed `EntityRef`/secondary context remain inside that module's route schema.
Adapters never create route namespaces. Unknown routes resolve to a recoverable
unavailable state. The route is clean-start: old query keys, localStorage
navigation state, and invented legacy aliases are not read, translated, or
dual-owned.

Adapter calls are backend-only and return validated payloads; the answer is
stamped with the adapter that gave it rather than trusting the answer to say.
An adapter cannot ship Vue components, HTML, JavaScript, browser code, paths,
secrets, or commands; a full route/workspace requires a separately declared
module.

## References and project membership

A work item's references are Planning's own records: a typed pointer (`memory`,
`session`, `commit` or `url`) with a stored label. A memory reference stays
readable when its provider is unavailable, and removing a provider does not
rewrite or delete the pointers that name it.

Planning project membership is never guessed from a board name, cwd, title,
label, filter, or data scope. A project's Planning space comes only from its
exact binding in the project registry, and the BoardRef decoding is confined to
the Planning implementation rather than shared Kernel identity. A binding reads
as `mapped`, `unbound` (no binding, another project's space, or a space the
bound store no longer has) or `unavailable` (the bound store is not reachable);
anything but `mapped` fails closed. A session without an exact stored relation
cannot acquire a project root from its observed working directory. Existing
Planning cards, refs, claims, history, and provider pointers remain system of
record, while removed UI/routes are not preserved as a compatibility layer.
