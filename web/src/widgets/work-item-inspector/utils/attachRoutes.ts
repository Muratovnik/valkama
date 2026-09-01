/**
 * Which attach actions may run on this card, and over which connection.
 *
 * This is authorization arithmetic over the registry and nothing else: no state,
 * no translation, no DOM. It answers with data so the panel can decide what to
 * call each candidate — the naming chain is a presentation question and lives with
 * the presentation.
 *
 * Five conditions have to hold for one candidate, and a candidate that fails any
 * of them is an ordinary absence rather than an error: the action is
 * adapter-owned, a ready capability resolves in this scope to exactly one
 * connection for that adapter, that connection is registered, trusted and
 * ready, and `relation.attach` is granted for this board's data scope.
 */

import type { ActionRef } from '@/shared/api/platformActionRef.ts'
import type { ActionInputDescriptor, PlatformRegistryReady } from '@/shared/api/platformApiTypes.ts'
import type { AdapterResourceRef } from '@/shared/api/platformEntityRef.ts'
import type { OperatingScope } from '@/shared/api/platformRoute.ts'

type ConnectionRef = AdapterResourceRef['connection_ref']

/** What an action is called, as keys the caller resolves in its own catalogue. */
export type CandidateNaming = {
  adapterTitleKey: string | null
  ownerId: string
  titleKey: string
}

export type AttachCandidate = {
  action: ActionRef
  connection_ref: ConnectionRef
  descriptor: ActionInputDescriptor
  key: string
  naming: CandidateNaming
  resource_type: string
}

function scopeEquals(left: OperatingScope, right: OperatingScope): boolean {
  return (
    left.kind === right.kind &&
    (left.kind === 'global' ||
      (right.kind === 'project' && left.project_ref.project_id === right.project_ref.project_id))
  )
}

function connectionApplies(
  applicability: OperatingScope,
  invocationScope: OperatingScope,
): boolean {
  return applicability.kind === 'global' || scopeEquals(applicability, invocationScope)
}

function connectionEquals(left: ConnectionRef, right: ConnectionRef): boolean {
  return (
    left.connection_id === right.connection_id &&
    left.adapter_lineage_id === right.adapter_lineage_id &&
    left.service_ref.owner_id === right.service_ref.owner_id &&
    left.service_ref.service_id === right.service_ref.service_id
  )
}

/** An attach action cleared to run, with the connection it would run over. */
type AttachRoute = {
  action: ActionRef
  connectionRef: ConnectionRef
  naming: CandidateNaming
}

function resolveAttachRoute(
  registry: PlatformRegistryReady,
  descriptor: ActionInputDescriptor,
  scope: OperatingScope,
  dataScopeId: string,
): AttachRoute | null {
  const action = registry.actions.find((item) => item.action_id === descriptor.action_id)
  if (!action || action.owner_kind !== 'adapter') return null
  const resolvedRefs = registry.capabilities
    .filter(
      (resolution) =>
        resolution.state === 'ready' &&
        resolution.assignment?.state === 'enabled' &&
        (resolution.assignment.scope.kind === 'installation' ||
          (scope.kind === 'project' &&
            resolution.assignment.scope.kind === 'project' &&
            resolution.assignment.scope.project_id === scope.project_ref.project_id)),
    )
    .flatMap((resolution) => resolution.connections.map((connection) => connection.connection_ref))
  const resolvedConnections = resolvedRefs
    .map((ref) =>
      registry.connections.find((candidate) => connectionEquals(candidate.connection_ref, ref)),
    )
    .filter((candidate) => candidate !== undefined)
    .filter(
      (candidate) =>
        candidate.connection_ref.adapter_lineage_id === action.owner_id &&
        connectionApplies(candidate.applicability, scope) &&
        candidate.state === 'registered' &&
        candidate.trust === 'trusted' &&
        candidate.health === 'ready',
    )
  const uniqueConnections = resolvedConnections.filter(
    (candidate, index) =>
      resolvedConnections.findIndex((other) =>
        connectionEquals(other.connection_ref, candidate.connection_ref),
      ) === index,
  )
  if (uniqueConnections.length !== 1) return null
  const connectionRef = uniqueConnections[0].connection_ref
  const granted = registry.grants.some(
    (grant) =>
      grant.adapter_lineage_id === action.owner_id &&
      grant.permission_id === 'relation.attach' &&
      grant.connection_ref !== null &&
      connectionEquals(grant.connection_ref, connectionRef) &&
      scopeEquals(grant.applicability, scope) &&
      grant.active &&
      grant.state === 'active' &&
      grant.entity_kinds.includes('adapter-resource') &&
      grant.data_scope_ids.includes(dataScopeId),
  )
  if (!granted) return null
  const adapter = registry.adapters.find((item) => item.adapter_lineage_id === action.owner_id)
  return {
    action,
    connectionRef,
    naming: {
      titleKey: descriptor.title_key,
      adapterTitleKey: adapter?.title_key ?? null,
      ownerId: adapter?.adapter_id ?? action.owner_id,
    },
  }
}

/**
 * Every attach candidate available here, one row per resource type an action
 * accepts.
 */
export function attachCandidates(
  registry: PlatformRegistryReady | null,
  invocationScope: OperatingScope,
  dataScopeId: string,
): AttachCandidate[] {
  if (!registry || invocationScope.kind !== 'project') return []
  const candidates: AttachCandidate[] = []
  for (const descriptor of registry.action_inputs) {
    if (descriptor.operation !== 'attach') continue
    const route = resolveAttachRoute(registry, descriptor, invocationScope, dataScopeId)
    if (!route) continue
    for (const resourceType of descriptor.resource_types) {
      candidates.push({
        key: String(candidates.length),
        action: route.action,
        descriptor,
        resource_type: resourceType,
        connection_ref: route.connectionRef,
        naming: route.naming,
      })
    }
  }
  return candidates
}
