---
status: adopted
card: 232
---

# ADR 0009: Agent Hub separates modules, adapters, services, and configuration

## Context

The Hub had a static registry for product pages but no user-facing model for
systems connected to those pages. Settings contained only browser preferences.
That encouraged two coupled mistakes:

- UI language treated a module, an event adapter, and an external service as if
  all three were interchangeable "plugins";
- visual hierarchy put navigation, controls, data, and reading surfaces on one
  pale layer, while row-level actions competed with the records they acted on.

The resulting symptoms were systemic: integrations were invisible, AgentMemory
could easily be overstated, session rows needed a separate "details" button,
source actions used implementation language, and the product felt more like a
styled concept than a dependable operating surface.

## Prior art reviewed

| System | Pattern retained | Pattern rejected |
| --- | --- | --- |
| [Grafana plugins](https://grafana.com/docs/grafana/latest/administration/plugin-management/plugin-types/) and [data sources](https://grafana.com/docs/grafana/latest/datasources/) | Distinguish a feature type from a configured connection instance. | Treat every extension as a dashboard or load third-party code merely to expose status. |
| [Home Assistant config entries](https://developers.home-assistant.io/docs/config_entries_index/), [setup failures](https://developers.home-assistant.io/docs/integration_setup_failures/), and [diagnostics](https://developers.home-assistant.io/docs/core/integration/diagnostics/) | Persisted configuration has an owner and lifecycle; unavailable, retrying, and authentication failure are not the same state; diagnostics redact secrets. | Device-oriented complexity and a universal enable switch for systems the Hub does not own. |
| [VS Code manifests](https://code.visualstudio.com/api/references/extension-manifest), [activation events](https://code.visualstudio.com/api/references/activation-events), and [Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust) | Declare capabilities, activate narrowly, and centralize trust instead of asking every extension to reinvent it. | Writing `trusted_hash`, bypassing client approval, or activating every adapter at Hub startup. |
| [Backstage frontend plugins](https://backstage.io/docs/frontend-system/architecture/plugins/) and [backend extension points](https://backstage.io/docs/backend-system/architecture/extension-points/) | Stable unique IDs, narrow extension points, isolated routes/APIs, and manifest ownership. | Package-per-feature ceremony and unrestricted runtime overrides for the current local product. |
| [Carbon color layers](https://carbondesignsystem.com/elements/color/usage/), [icons](https://carbondesignsystem.com/elements/icons/usage/), and [structured lists](https://carbondesignsystem.com/components/structured-list/usage/) | Dark shell zones may coexist with light working layers; icons share an optical size; a selectable row owns its primary interaction. | Copying Carbon's visual identity or component markup. |
| [Primer ActionList](https://primer.style/product/components/action-list/guidelines/) and [NavList](https://primer.style/product/components/nav-list/guidlines/) | Use the whole item for its primary action; trailing actions stay secondary and independently accessible; leading visuals are consistent. | Mixing navigation links and unrelated actions in one item. |

## Decision

### 1. Four concepts remain distinct

- **Hub module** — a trusted product destination such as Planning or Analytics.
- **Session adapter** — a normalized event producer owned by the client
  trust/configuration surface.
- **Knowledge service** — an external local service such as AgentMemory with a
  health boundary and explicit capabilities.
- **Configured connection** — a future persisted instance owned by the system
  that can safely create, update, remove, and migrate it.

The current Hub does not load arbitrary plugin code. Dynamic installation is
deferred until signing, permissions, activation, rollback, and configuration
migration have explicit contracts and tests.

### 2. Integration inventory is a read model, not an off switch

`GET /api/integrations` returns the unnumbered `integrations` contract. Each
entry has a stable ID, kind, owner, configuration owner, status, reason,
observation time, capabilities, and direct-read boundary.

Statuses are:

- `ready`: evidence confirms a usable adapter or service;
- `not-observed`: an adapter is known but has emitted no event yet;
- `degraded`: the owning system responded with unhealthy state;
- `unavailable`: the bounded local health probe failed.

Absence of events is never rendered as disabled. The Hub does not expose a
toggle for a client or service it does not own.

### 3. Trust remains with the owner

Codex approval remains represented by Codex's own `trusted_hash` state. Hub
code never writes or infers that approval. Claude hook pins remain owned by the
workspace and shared adapter. Session history can prove that events were
observed; it cannot prove that a hook is still installed at this instant.

AgentMemory is service-managed. Hub may read its loopback health endpoint,
store one-way memory references, and receive bounded lesson signals. It does
not query or mutate memory content on the user's behalf.

### 4. Interface hierarchy follows the same ownership model

- matte dark navigation and context chrome own product location;
- cool neutral canvas owns workspace separation;
- white ledger surfaces own data and reading;
- semantic color is reserved for state and consequential actions;
- a session row owns selection/opening, while acknowledgement is one quiet
  trailing action;
- both right-side detail surfaces expose bounded pointer and keyboard resizing,
  while the persistent session inspector also preserves ledger workspace;
- source actions name user intent and appear only when the backend can supply
  meaningful local context.

All navigation icons use one optical box. Responsive decisions follow the
actual component/workspace width rather than viewport-only assumptions.

## Consequences

- Settings becomes the truthful inventory and diagnostic entry point without
  claiming authority it lacks.
- Adding a new adapter or service requires a manifest entry, capability names,
  a bounded health/observation provider, contract validation, and localized
  presentation.
- A future writable connection must add an owner-correct config-entry
  lifecycle; it cannot repurpose the read-only registry or add an `enabled`
  boolean by convention.
- Visual changes remain semantic token changes and component contracts, not a
  copy of any researched product.

## Acceptance

- malformed integration payloads fail at the frontend resource boundary;
- AgentMemory explicitly reports `direct_read=false`;
- no integration entry fabricates an `enabled` property;
- session rows open by row click/keyboard and retain a separate accessible
  acknowledgement action;
- URL evidence has no redundant resolve action; commit/session evidence uses
  the localized `Inspect source` intent;
- navigation glyphs and badges do not overlap at expanded, collapsed, or narrow
  widths;
- shell and body text meet WCAG AA in both light and dark zones.

## Owner amendment: Phase 0 platform boundary (2026-08-13)

This amendment freezes the provider-neutral contracts for the extensible Agent
Hub. It supersedes any earlier shorthand that conflates a module, adapter,
service, connection, assignment, or permission. Populated cards, refs, claims,
links, comments, history, and provider pointers remain the system of record;
this is a clean-start contract and does not add legacy aliases or a dual-read
compatibility layer.

### Stable identities and ownership

The following records are distinct and are never inferred from one another:

```text
ServiceRef       { owner_id, service_id }
AdapterLineage   { adapter_lineage_id, adapter_id, publisher_id, owner_id,
                   package_id, version, tombstone? }
ConnectionRef    { service_ref: ServiceRef, adapter_lineage_id, connection_id }
AdapterAssignment { assignment_id, adapter_lineage_id,
                    applicability: Global | ProjectRef,
                    connection_refs[], default_connection_ref?,
                    activation: enabled | disabled, revision }
PermissionGrant  { grant_id, adapter_lineage_id,
                   connection_ref: ConnectionRef | none,
                   permission_id, applicability: Global | ProjectRef,
                   entity_kinds[], granted_by, revision }
```

`ServiceRef` is provider-neutral and stable in its owner namespace. An adapter
lineage is immutable; duplicate IDs and tombstone takeover are rejected.
`ConnectionRef` names one provider instance and one lineage, even for a
singleton (`connection_id=singleton`). Its health, trust, diagnostics, and
applicability belong to that connection, not to the service descriptor or
adapter registration. Registration never creates an assignment. Exactly one
`AdapterAssignment` exists for a lineage and applicability; a Project
assignment may name only Global-applicable or that exact Project's connections.
Changing its connection set never widens an existing grant.

Manifest `permissions[]` is a declaration, not authorization. Default is deny.
Every adapter invoke requires a declared capability, an enabled assignment,
the exact applicable `PermissionGrant`, and a matching connection when the
capability is connection-bound. Global grants do not authorize Projects, and a
Project grant does not authorize another Project. Revocation blocks new calls,
invalidates contribution caches, and leaves relations/tombstones intact.

### Invocation and action boundaries

```text
InvocationContext {
  view_scope: Global | ProjectRef
  invocation_scope: Global | ProjectRef
  target: EntityRef | RegistryRef
}

ActionRef {
  action_id: core.<name> | module.<module_id>.<name> |
             adapter.<adapter_lineage_id>.<name>
  owner_kind: kernel | module | adapter
  owner_id
  input_schema_id
  target_kind
  invocation_scope_schema
}
```

`view_scope` is navigation context, not authorization. A Global governance
action over a project-owned record must carry an explicitly selected exact
`invocation_scope=ProjectRef`; the backend checks that Project grant and audits
both scopes. A Project invocation must prove the current
`EntityRef → BoardRef → ProjectBoardBinding`; `data_scope_id` alone is
insufficient. Duplicate or cross-owner `ActionRef` values are rejected, and
one backend dispatcher owns availability, permission, confirmation, and
execution regardless of where an action is rendered.

Adapters contribute only named, validated slots: relation resolver, typed entity
action, declarative inspector/status, normalized event source, bounded read
model, and settings/connection entry. A contribution is requested by slot and
`EntityRef`; core consumers never branch on a provider or adapter ID. Adapter
and package provenance does not create a route. Routes belong only to stable
module IDs and the required `Global | ProjectRef` discriminant.

### Browser and AgentMemory boundary

Adapters execute behind the backend boundary. Browser payloads are validated,
bounded, and redacted: adapters cannot return arbitrary HTML, Vue components,
JavaScript, commands, absolute paths, secrets, or raw provider/transcript
content. External open actions use registered target kinds and URI allowlists.

AgentMemory is the first reference adapter, not a privileged core branch. Its
service, lineage, and singleton connection are registered through the same
contracts. Existing `refs.kind=memory` rows remain pointer-only core records and
have one audited resolver binding. The shipped contract is
`direct_read=false`: no summary, search result, or memory body may be read by
Hub. Phase 0 permits only a known stable record ID, health, bounded pointer link,
and an allowlisted open action. Any future bounded read requires another dated
ADR amendment with an explicit permission owner and redaction contract.

### ProjectBoardBinding is owner-authored

```text
ProjectBoardBinding {
  project_id
  data_scope_id
  board_name
  registry_revision
  source_owner
  source_hash
}
```

The owning project workspace creates, updates, and removes this binding in its
registration source. Neutral host tooling may validate and project that owner
record, but may not infer product semantics. Hub reads the
projection and records only the observed revision in audit. Detach preserves
the exact identity as unavailable; reattach restores that same identity. Board
names, cwd, titles, aliases, last-seen revision, and data scope are never
membership inference. Unbound, ambiguous, stale, detached, competing, and
same-store/cross-project bindings fail closed and require an explicit audited
owner rebind.

### Acceptance boundary

The contract suite must cover undeclared, ungranted, revoked, cross-scope,
omitted-connection, wrong-project-connection, stale-binding, duplicate-action,
lineage-takeover, arbitrary-browser-payload, AgentMemory direct-read, and
provider-specific-core-branch failures. A second provider must pass the same
black-box contract without edits to shell, route owner, CardDrawer, or common
relation components.
