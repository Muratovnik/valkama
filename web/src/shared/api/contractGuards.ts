/**
 * The primitives every hand-written wire validator needs.
 *
 * `contract.ts` holds the Zod building blocks; this holds the ones for the
 * validators that are still hand-written, in the same refusal vocabulary
 * (`path: detail`) and behind the caller's own `Refusal`, so a module keeps
 * throwing its own error type with its own contract code.
 *
 * These were five byte-identical copies of `plainObject` and `exactKeys`, four
 * of the pollution-key set, three of the same 32/16384 ceilings under three
 * different names, and two of the SemVer check. A copy is not free: it is a
 * place a hardening fix can be applied four times out of five, which is how a
 * validator ends up strict on one boundary and permissive on the next.
 */

import type { Refusal } from '@/shared/api/contract.ts'

/** Keys that must never be carried from a wire payload into an object. */
export const POLLUTION_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'prototype',
  'constructor',
])

/**
 * How deep and how wide a validated payload may be. These bound the recursive
 * walkers; a payload past either ceiling is refused rather than traversed.
 */
export const MAX_CONTRACT_DEPTH = 32
export const MAX_CONTRACT_NODES = 16_384

/**
 * SemVer 2.0.0, in two parts on purpose: the pattern accepts the shape, and
 * `isCanonicalSemver` rejects the leading zeros the pattern cannot express
 * without becoming unreadable.
 */
const SEMVER =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u
const MAX_SEMVER_LENGTH = 128

/**
 * What one walk over a payload tree spends as it descends: how deep it is, which
 * objects it has already entered, and how many values it has counted.
 *
 * The three are one thing -- a budget for this walk -- and every validator here
 * carries all three. Passing them separately is what put five parameters on
 * each of those signatures.
 */
export interface WalkBudget {
  depth: number
  nodes: { count: number }
  seen: WeakSet<object>
}

/** A budget for a walk that starts at the root of a payload. */
export function walkBudget(): WalkBudget {
  return { depth: 0, nodes: { count: 0 }, seen: new WeakSet<object>() }
}

/** One level down. The cycle set and the node count stay shared with the parent. */
export function descend(walk: WalkBudget): WalkBudget {
  return { depth: walk.depth + 1, nodes: walk.nodes, seen: walk.seen }
}

export function isCanonicalSemver(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SEMVER_LENGTH)
    return false
  const match = SEMVER.exec(value)
  if (match === null) return false
  for (const component of match.slice(1, 4)) {
    if (component.length > 1 && component.startsWith('0')) return false
  }
  const prerelease = match[4]
  if (prerelease !== undefined) {
    for (const identifier of prerelease.split('.')) {
      if (/^\d+$/u.test(identifier) && identifier.length > 1 && identifier.startsWith('0'))
        return false
    }
  }
  // The pattern already guarantees non-empty identifiers and the permitted
  // character set for both prerelease and build metadata.
  return true
}

export interface ContractGuards {
  /**
   * Exactly the declared keys. An unknown field is refused rather than
   * trimmed, because the server refuses the same shape on its side.
   */
  exactKeys: (value: Record<string, unknown>, keys: readonly string[], path: string) => void
  /**
   * A plain-JSON object. A class instance never arrives over this wire, and a
   * prototype that is not Object's says the value did not come from JSON.
   */
  plainObject: (value: unknown, path: string) => Record<string, unknown>
}

/** Bind the shared guards to one module's refusal, so the thrown error keeps
 *  that module's own type and contract code. */
export function contractGuards(invalid: Refusal): ContractGuards {
  return {
    plainObject(value: unknown, path: string): Record<string, unknown> {
      if (typeof value !== 'object' || value === null || Array.isArray(value))
        invalid(path, 'expected object')
      const prototype = Object.getPrototypeOf(value)
      if (prototype !== Object.prototype && prototype !== null)
        invalid(path, 'expected plain object')
      return value as Record<string, unknown>
    },
    exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
      const allowed = new Set(keys)
      for (const key of Object.keys(value))
        if (!allowed.has(key)) invalid(`${path}.${key}`, 'unknown field')
    },
  }
}
