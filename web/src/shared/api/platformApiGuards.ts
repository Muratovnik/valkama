/**
 * The bounds and the refusal every Platform read model is checked against.
 *
 * One error type, one set of patterns, and the envelope helper that reads
 * `interface_version` before anything else in a payload is trusted.
 */

import { boundedList, z } from '@/shared/api/contract.ts'
import type { EntityKind } from '@/shared/api/platformEntityRef.ts'
import type { OperatingScope } from '@/shared/api/platformRoute.ts'

class PlatformApiContractError extends Error {
  readonly code = 'platform_api_contract_invalid' as const

  constructor(path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'PlatformApiContractError'
  }
}

export const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u
/**
 * An i18n message key, which is not an identity. This product's own message
 * catalogue names its leaves in camelCase — `platform.integrations.claudeCode`
 * — so a lowercase-only pattern refused the registry's real `title_key` values
 * and failed the whole Settings view on a payload that was correct. Anything
 * looked up in the catalogue matches this; an identifier matches `ID`.
 */
export const MESSAGE_KEY = /^[a-z][A-Za-z0-9._-]{0,95}$/u
export const PROJECT_ID = /^[a-z][a-z0-9-]{0,159}$/u
export const SHA256 = /^[0-9a-f]{64}$/u
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
/**
 * Full SemVer 2.0.0, which refuses a leading zero where `contractGuards.SEMVER`
 * allows one. An adapter version is compared for equality across a wire, so
 * `01.0.0` and `1.0.0` must not both be accepted as the same release.
 */
export const STRICT_SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u
export const ISO = /^\d{4}-\d{2}-\d{2}T[^\s]{1,80}Z$/u
export const BINDING_STATES = [
  'mapped',
  'unbound',
  'stale',
  'detached',
  'ambiguous',
  'unavailable',
] as const

function invalid(path: string, detail: string): never {
  throw new PlatformApiContractError(path, detail)
}

/**
 * A required enumerated field. On its own `z.enum` answers an absent key with
 * its own "unknown value", which would erase the difference between a field
 * that never arrived and one carrying a value outside the set; making it
 * explicitly optional and then non-optional keeps both refusals distinct, the
 * way the hand-written key check reported them.
 */
export function enumField<T extends string>(values: readonly T[], message = 'unknown value') {
  return z
    .enum([...values] as [T, ...T[]], { message })
    .optional()
    .nonoptional()
}

function scopesEqual(left: OperatingScope, right: OperatingScope): boolean {
  return (
    left.kind === right.kind &&
    (left.kind === 'global' ||
      (right.kind === 'project' && left.project_ref.project_id === right.project_ref.project_id))
  )
}

const ENTITY_KINDS: readonly EntityKind[] = [
  'project',
  'planning-space',
  'workflow',
  'work-item',
  'execution',
  'session',
  'skill',
  'memory-resource',
  'artifact',
  'improvement-case',
  'service',
  'connection',
  'registry',
]

export const entityKindsSchema = boundedList(enumField(ENTITY_KINDS), 128).refine(
  (kinds) => new Set(kinds).size === kinds.length,
  { message: 'duplicate entity kind' },
)

/** Authorization may target a provider-owned resource without making that
 * target a Kernel EntityKind. Keep that distinction explicit at the schema
 * owner instead of widening the neutral entity contract. */
export const authorizationTargetKindsSchema = boundedList(
  enumField([...ENTITY_KINDS, 'adapter-resource'] as const),
  128,
).refine((kinds) => new Set(kinds).size === kinds.length, {
  message: 'duplicate authorization target kind',
})

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`
}

export function assertScope(actual: OperatingScope, expected: OperatingScope, path: string): void {
  if (!scopesEqual(actual, expected)) invalid(path, 'response scope does not match request scope')
}
