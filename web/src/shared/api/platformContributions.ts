/**
 * The declarative contribution contract: what an adapter or module may add to a
 * surface, and nothing that could execute.
 *
 * Everything here is spelled `contribution*` and bounded separately from the
 * relation contract next door, because a contribution is untrusted text from a
 * provider while a relation is a resolved pointer this product wrote. The two
 * share three names and no code.
 */

import { isCanonicalSemver } from '@/shared/api/contractGuards.ts'
import { validateActionRef } from '@/shared/api/platformActionRef.ts'
import type { ActionRef } from '@/shared/api/platformActionRef.ts'
import { contributionContent } from '@/shared/api/platformContributionContent.ts'
import type { DeclarativeContributionContent } from '@/shared/api/platformContributionContent.ts'
import {
  CONTRIBUTION_SLOTS,
  contributionEntityKinds,
  contributionId,
  contributionInvalid,
  contributionKeys,
  contributionObject,
  rejectUnsafeContributionTree,
} from '@/shared/api/platformContributionGuards.ts'
import type { EntityKind } from '@/shared/api/platformEntityRef.ts'

/** Declarative contribution contract; provider code never crosses this boundary. */
const CONTRIBUTIONS_INTERFACE = 'valkama-contributions' as const
type ContributionSlot =
  | 'entity-relation-resolver'
  | 'entity-action'
  | 'inspector-section'
  | 'normalized-event-source'
  | 'settings-connection-entry'
  | 'read-model-provider'
  | 'status-diagnostics'
type ContributionOwnerKind = 'adapter' | 'module'
type ContributionProvenance = {
  adapter_id: string
  adapter_lineage_id: string
  adapter_version: string
  connection_id: string
}
export type DeclarativeContribution = {
  actions: ActionRef[]
  content: DeclarativeContributionContent
  contribution_id: string
  entity_kinds: EntityKind[]
  interface_version: typeof CONTRIBUTIONS_INTERFACE
  owner_id: string
  owner_kind: ContributionOwnerKind
  slot: ContributionSlot
  module_id?: import('@/shared/api/platformModuleContract.ts').ModuleId
  provenance?: ContributionProvenance
}
export type ContributionsPayload = {
  contributions: DeclarativeContribution[]
  interface_version: typeof CONTRIBUTIONS_INTERFACE
}
function contributionProvenance(value: unknown, path: string): ContributionProvenance {
  const object = contributionObject(value, path)
  contributionKeys(
    object,
    ['adapter_id', 'adapter_lineage_id', 'adapter_version', 'connection_id'],
    path,
  )
  if (!isCanonicalSemver(object.adapter_version))
    contributionInvalid(`${path}.adapter_version`, 'expected full SemVer 2.0.0 value')
  return {
    adapter_id: contributionId(object.adapter_id, `${path}.adapter_id`),
    adapter_lineage_id: contributionId(object.adapter_lineage_id, `${path}.adapter_lineage_id`),
    adapter_version: object.adapter_version,
    connection_id: contributionId(object.connection_id, `${path}.connection_id`),
  }
}

/** The modules a contribution may name. */
const CONTRIBUTION_MODULE_IDS = new Set([
  'analytics',
  'improvements',
  'planning',
  'sessions',
  'settings',
  'skills',
])

/**
 * An optional field written as an explicit `undefined` is refused.
 *
 * On the wire "absent" and "present but undefined" are the same thing, and JSON
 * cannot express the second at all -- so a payload that manages to carry it was
 * built by something that is not speaking this contract.
 */
function rejectExplicitUndefined(
  object: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): void {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(object, key) && object[key] === undefined)
      contributionInvalid(`${path}.${key}`, 'optional field cannot be undefined')
  }
}

/** The module a contribution names, or undefined when it names none. */
function contributionModuleId(
  value: unknown,
  path: string,
): DeclarativeContribution['module_id'] | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !CONTRIBUTION_MODULE_IDS.has(value))
    contributionInvalid(`${path}.module_id`, 'unknown module id')
  return value as DeclarativeContribution['module_id']
}

/** A bounded action list with no id used twice. */
function contributionActions(value: unknown, path: string): ActionRef[] {
  if (!Array.isArray(value) || value.length > 128)
    contributionInvalid(`${path}.actions`, 'expected bounded action list')
  const actions = value.map((action, index) =>
    validateActionRef(action, `${path}.actions[${index}]`),
  )
  const ids = new Set(actions.map((action) => action.action_id))
  if (ids.size !== actions.length) contributionInvalid(`${path}.actions`, 'duplicate action id')
  return actions
}

export function validateContribution(
  value: unknown,
  path = 'contribution',
): DeclarativeContribution {
  rejectUnsafeContributionTree(value, path)
  const object = contributionObject(value, path)
  contributionKeys(
    object,
    [
      'interface_version',
      'contribution_id',
      'owner_kind',
      'owner_id',
      'slot',
      'entity_kinds',
      'content',
      'actions',
    ],
    path,
    ['module_id', 'provenance'],
  )
  rejectExplicitUndefined(object, ['module_id', 'provenance'], path)
  if (object.interface_version !== CONTRIBUTIONS_INTERFACE)
    contributionInvalid(`${path}.interface_version`, `expected ${CONTRIBUTIONS_INTERFACE}`)
  const ownerKind = object.owner_kind
  if (ownerKind !== 'adapter' && ownerKind !== 'module')
    contributionInvalid(`${path}.owner_kind`, 'unknown owner kind')
  const owner = contributionId(object.owner_id, `${path}.owner_id`)
  const slot = object.slot
  if (typeof slot !== 'string' || !CONTRIBUTION_SLOTS.has(slot as ContributionSlot))
    contributionInvalid(`${path}.slot`, 'unknown contribution slot')
  const moduleId = contributionModuleId(object.module_id, path)
  if (ownerKind === 'module' && moduleId !== owner)
    contributionInvalid(`${path}.module_id`, 'module contribution owner must match module_id')
  const actions = contributionActions(object.actions, path)
  const result: DeclarativeContribution = {
    interface_version: CONTRIBUTIONS_INTERFACE,
    contribution_id: contributionId(object.contribution_id, `${path}.contribution_id`),
    owner_kind: ownerKind,
    owner_id: owner,
    slot: slot as ContributionSlot,
    entity_kinds: contributionEntityKinds(object.entity_kinds, `${path}.entity_kinds`),
    content: contributionContent(object.content, `${path}.content`),
    actions,
  }
  if (moduleId !== undefined) result.module_id = moduleId
  if (object.provenance !== undefined) {
    if (ownerKind !== 'adapter')
      contributionInvalid(
        `${path}.provenance`,
        'only adapter contributions carry provider provenance',
      )
    result.provenance = contributionProvenance(object.provenance, `${path}.provenance`)
  }
  return result
}

function validateContributions(value: unknown, path = 'contributions'): DeclarativeContribution[] {
  if (!Array.isArray(value) || value.length > 256)
    contributionInvalid(path, 'expected bounded contribution list')
  const contributions = value.map((entry, index) =>
    validateContribution(entry, `${path}[${index}]`),
  )
  const ids = new Set(contributions.map((contribution) => contribution.contribution_id))
  if (ids.size !== contributions.length) contributionInvalid(path, 'duplicate contribution id')
  return contributions
}

export function validateContributionsPayload(
  value: unknown,
  path = 'payload',
): ContributionsPayload {
  const object = contributionObject(value, path)
  contributionKeys(object, ['interface_version', 'contributions'], path)
  if (object.interface_version !== CONTRIBUTIONS_INTERFACE)
    contributionInvalid(`${path}.interface_version`, `expected ${CONTRIBUTIONS_INTERFACE}`)
  return {
    interface_version: CONTRIBUTIONS_INTERFACE,
    contributions: validateContributions(object.contributions, `${path}.contributions`),
  }
}
