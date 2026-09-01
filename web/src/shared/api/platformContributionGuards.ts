/**
 * What every part of a declarative contribution must satisfy before it is read.
 *
 * A contribution is untrusted text from a provider, so each primitive here is
 * bounded and refuses rather than coerces: ids match one pattern, text has a
 * ceiling, keys are checked against prototype pollution and provider/body/path
 * content, and the tree walk spends a budget it cannot exceed.
 */

import { descend, walkBudget } from '@/shared/api/contractGuards.ts'
import type { WalkBudget } from '@/shared/api/contractGuards.ts'
import type { EntityKind } from '@/shared/api/platformEntityRef.ts'

/** Refusing a contribution is a distinct failure from refusing a relation. */
class PlatformContributionValidationError extends Error {
  readonly code = 'platform_contributions_contract_invalid' as const

  constructor(message: string) {
    super(message)
    this.name = 'PlatformContributionValidationError'
  }
}

const CONTRIBUTION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u
export const CONTRIBUTION_SLOTS = new Set<string>([
  'entity-relation-resolver',
  'entity-action',
  'inspector-section',
  'normalized-event-source',
  'settings-connection-entry',
  'read-model-provider',
  'status-diagnostics',
])
const CONTRIBUTION_HTML_OR_JS = /<[^>]*>|\b(?:javascript|data|file)\s*:/iu
const CONTRIBUTION_ABSOLUTE_PATH = /(?:^|\s)(?:[A-Za-z]:[\\/]|\\\\|\/)(?:[^\s]+)/u
const CONTRIBUTION_POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const CONTRIBUTION_UNSAFE_KEY =
  /(?:html|script|javascript|file|path|secret|token|password|credential|transcript|memory[_-]?body|provider[_-]?body|search[_-]?result|raw)/iu
const CONTRIBUTION_MAX_DEPTH = 32
const CONTRIBUTION_MAX_NODES = 16_384

export function contributionInvalid(path: string, detail: string): never {
  throw new PlatformContributionValidationError(`${path}: ${detail}`)
}

export function contributionText(value: unknown, path: string, max = 2000): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max)
    contributionInvalid(path, 'expected bounded text')
  if (CONTRIBUTION_HTML_OR_JS.test(value) || CONTRIBUTION_ABSOLUTE_PATH.test(value))
    contributionInvalid(path, 'HTML/JS/path content is not allowed')
  return value
}

export function contributionId(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 160 ||
    !CONTRIBUTION_ID.test(value)
  )
    contributionInvalid(path, 'expected bounded owner/id')
  return value
}

export function contributionObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    contributionInvalid(path, 'expected object')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null)
    contributionInvalid(path, 'expected plain object')
  return value as Record<string, unknown>
}

/**
 * The two ways a key inside a contribution is refused before its value is read.
 *
 * Written once for both readers: the tree walker that descends into an unknown
 * payload, and the field checker that knows which keys it expects.
 */
function rejectUnsafeContributionKey(key: string, path: string): void {
  if (CONTRIBUTION_POLLUTION_KEYS.has(key))
    contributionInvalid(`${path}.${key}`, 'prototype-pollution key is not allowed')
  if (CONTRIBUTION_UNSAFE_KEY.test(key))
    contributionInvalid(`${path}.${key}`, 'provider/body/path content is not allowed')
}

export function rejectUnsafeContributionTree(
  value: unknown,
  path: string,
  walk: WalkBudget = walkBudget(),
): void {
  if (walk.depth > CONTRIBUTION_MAX_DEPTH)
    contributionInvalid(path, `payload exceeds depth ${CONTRIBUTION_MAX_DEPTH}`)
  walk.nodes.count += 1
  if (walk.nodes.count > CONTRIBUTION_MAX_NODES)
    contributionInvalid(path, `payload exceeds ${CONTRIBUTION_MAX_NODES} values`)
  if (typeof value === 'string') {
    if (CONTRIBUTION_HTML_OR_JS.test(value) || CONTRIBUTION_ABSOLUTE_PATH.test(value))
      contributionInvalid(path, 'HTML/JS/file/path content is not allowed')
    return
  }
  if (value === null || typeof value !== 'object') return
  if (walk.seen.has(value)) contributionInvalid(path, 'cyclic payload is not allowed')
  walk.seen.add(value)
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries())
      rejectUnsafeContributionTree(entry, `${path}[${index}]`, descend(walk))
    walk.seen.delete(value)
    return
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null)
    contributionInvalid(path, 'expected plain object')
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    rejectUnsafeContributionKey(key, path)
    rejectUnsafeContributionTree(entry, `${path}.${key}`, descend(walk))
  }
  walk.seen.delete(value)
}

export function contributionKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...keys, ...optional])
  for (const key of Object.keys(value)) {
    rejectUnsafeContributionKey(key, path)
    if (!allowed.has(key)) contributionInvalid(`${path}.${key}`, 'unknown field')
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key))
      contributionInvalid(`${path}.${key}`, 'missing required field')
  }
}

export function contributionEntityKinds(value: unknown, path: string): EntityKind[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32)
    contributionInvalid(path, 'expected bounded entity-kind list')
  const kinds = value.map((entry, index) => {
    if (
      typeof entry !== 'string' ||
      ![
        'artifact',
        'connection',
        'execution',
        'improvement-case',
        'memory-resource',
        'planning-space',
        'project',
        'registry',
        'service',
        'session',
        'skill',
        'work-item',
        'workflow',
      ].includes(entry)
    )
      contributionInvalid(`${path}[${index}]`, 'unknown entity kind')
    return entry as EntityKind
  })
  if (new Set(kinds).size !== kinds.length)
    contributionInvalid(path, 'duplicate entity kinds are not allowed')
  return kinds
}
