/**
 * The bounds and the refusal every Platform read model is checked against.
 *
 * One error type, one set of patterns, and the envelope helper that reads
 * `interface_version` before anything else in a payload is trusted.
 */

import { z } from '@/shared/api/contract.ts'
import type { OperatingScope } from '@/shared/api/platformRoute.ts'

class PlatformApiContractError extends Error {
  readonly code = 'platform_api_contract_invalid' as const

  constructor(path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'PlatformApiContractError'
  }
}

export const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u
export const PROJECT_ID = /^[a-z][a-z0-9-]{0,159}$/u
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
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
