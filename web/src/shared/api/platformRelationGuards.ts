/**
 * The bounds every value in the relation and reference contracts is held to.
 *
 * One refusal helper, one set of string primitives, one tree walk with a budget.
 * They live below both contracts because both spend them, and putting them in
 * either one would make the other import its sibling.
 */

import {
  contractGuards,
  descend,
  MAX_CONTRACT_DEPTH,
  MAX_CONTRACT_NODES,
  POLLUTION_KEYS,
  walkBudget,
} from '@/shared/api/contractGuards.ts'
import type { WalkBudget } from '@/shared/api/contractGuards.ts'

class PlatformRelationsValidationError extends Error {
  readonly code = 'platform_relations_contract_invalid' as const

  constructor(message: string) {
    super(message)
    this.name = 'PlatformRelationsValidationError'
  }
}

export const MAX_ID_LENGTH = 160
export const MAX_LABEL_LENGTH = 240
export const MAX_RELATIONS = 500
// RFC 4122 canonical form: lowercase, version 1-5, and a valid variant.
// The owning Python contract uses the same grammar; keep both boundary
// validators byte-for-byte aligned so a BoardRef cannot change identity when
// it crosses the frontend/backend boundary.
export const UUID_LOWERCASE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
export const PROJECT_ID = /^[a-z][a-z0-9-]{0,159}$/u
// Keep provider/provenance versions on the same full SemVer 2.0.0 grammar as
// module manifests and the backend contract (including numeric prerelease
// identifiers without leading zeroes).
export const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
export const KEY = /^[a-z][a-z0-9._-]{0,63}$/
const UNSAFE_TEXT =
  // The /i flag makes A-Z and a-z one range. Spelling both states the intent
  // where the flag sits eighty characters away, at the end of the pattern.
  // eslint-disable-next-line sonarjs/duplicates-in-character-class -- see above
  /<[^>]*>|\b(?:javascript|data|file)\s*:|(?:^|\s)(?:[A-Za-z]:[\\/]|\\\\|\/)(?:[^\s]+)/iu

export function invalid(path: string, detail: string): never {
  throw new PlatformRelationsValidationError(`${path}: ${detail}`)
}

export const { plainObject, exactKeys } = contractGuards(invalid)

export function requiredString(
  value: unknown,
  path: string,
  pattern: RegExp = ID,
  max = MAX_ID_LENGTH,
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > max ||
    !pattern.test(value)
  ) {
    invalid(path, 'expected bounded identifier string')
  }
  return value
}

export function optionalString(
  value: unknown,
  path: string,
  max = MAX_LABEL_LENGTH,
): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0 || value.length > max)
    invalid(path, 'expected bounded string')
  return value
}

export function presentationText(value: unknown, path: string, max = MAX_LABEL_LENGTH): string {
  const result = optionalString(value, path, max)
  if (result === undefined) invalid(path, 'expected bounded text')
  if (UNSAFE_TEXT.test(result)) invalid(path, 'HTML/JS/file/path content is not allowed')
  return result
}

export function rejectUnsafeTree(
  value: unknown,
  path: string,
  walk: WalkBudget = walkBudget(),
): void {
  if (walk.depth > MAX_CONTRACT_DEPTH) invalid(path, `payload exceeds depth ${MAX_CONTRACT_DEPTH}`)
  walk.nodes.count += 1
  if (walk.nodes.count > MAX_CONTRACT_NODES)
    invalid(path, `payload exceeds ${MAX_CONTRACT_NODES} values`)
  if (typeof value === 'string') {
    if (UNSAFE_TEXT.test(value)) invalid(path, 'HTML/JS/file/path content is not allowed')
    return
  }
  if (value === null || typeof value !== 'object') return
  if (walk.seen.has(value)) invalid(path, 'cyclic payload is not allowed')
  walk.seen.add(value)
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries())
      rejectUnsafeTree(entry, `${path}[${index}]`, descend(walk))
    walk.seen.delete(value)
    return
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) invalid(path, 'expected plain object')
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (POLLUTION_KEYS.has(key)) invalid(`${path}.${key}`, 'prototype-pollution key is not allowed')
    rejectUnsafeTree(entry, `${path}.${key}`, descend(walk))
  }
  walk.seen.delete(value)
}

export function isoDate(value: unknown, path: string): string {
  const result = requiredString(value, path, /^\d{4}-\d{2}-\d{2}T[^\s]{1,80}Z$/u, 96)
  const parsed = Date.parse(result)
  if (!Number.isFinite(parsed)) invalid(path, 'expected ISO timestamp')
  return result
}
