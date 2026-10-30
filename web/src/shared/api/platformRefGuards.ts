/**
 * The bounds every value in the reference contracts is held to.
 *
 * One refusal helper and one set of string primitives. They live below the
 * entity and Planning ref contracts because both spend them, and putting them
 * in either one would make the other import its sibling.
 */

import { contractGuards } from '@/shared/api/contractGuards.ts'

class PlatformRefValidationError extends Error {
  readonly code = 'platform_ref_contract_invalid' as const

  constructor(message: string) {
    super(message)
    this.name = 'PlatformRefValidationError'
  }
}

const MAX_ID_LENGTH = 160
// RFC 4122 canonical form: lowercase, version 1-5, and a valid variant.
// The owning Python contract uses the same grammar; keep both boundary
// validators byte-for-byte aligned so a space ref cannot change identity when
// it crosses the frontend/backend boundary.
export const UUID_LOWERCASE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
export const PROJECT_ID = /^[a-z][a-z0-9-]{0,159}$/u
export const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/

export function invalid(path: string, detail: string): never {
  throw new PlatformRefValidationError(`${path}: ${detail}`)
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
