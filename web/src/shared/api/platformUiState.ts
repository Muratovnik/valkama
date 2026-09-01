/** Common bounded UI state grammar shared by every Platform module. */

import {
  contractGuards,
  descend,
  MAX_CONTRACT_DEPTH,
  MAX_CONTRACT_NODES,
  POLLUTION_KEYS,
  walkBudget,
} from '@/shared/api/contractGuards.ts'
import type { WalkBudget } from '@/shared/api/contractGuards.ts'
import { validateActionRef } from '@/shared/api/platformActionRef.ts'
import type { ActionRef } from '@/shared/api/platformActionRef.ts'

const UI_STATE_INTERFACE = 'valkama-ui-state' as const

type PlatformUiStateName =
  'loading' | 'ready' | 'empty' | 'error' | 'unavailable' | 'permission-denied' | 'degraded'

export type PlatformUiState<T = unknown> =
  | { interface_version: typeof UI_STATE_INTERFACE; status: 'loading' }
  | { interface_version: typeof UI_STATE_INTERFACE; payload: T; status: 'ready' }
  | { interface_version: typeof UI_STATE_INTERFACE; status: 'empty'; reason?: string }
  | {
      interface_version: typeof UI_STATE_INTERFACE
      reason: string
      status: 'error'
      retry_action?: ActionRef
    }
  | {
      interface_version: typeof UI_STATE_INTERFACE
      reason: string
      status: 'unavailable'
      retry_action?: ActionRef
    }
  | {
      interface_version: typeof UI_STATE_INTERFACE
      reason: string
      status: 'permission-denied'
    }
  | {
      interface_version: typeof UI_STATE_INTERFACE
      observed_at: string
      payload: T
      stale: true
      status: 'degraded'
      reason?: string
    }

class PlatformUiStateValidationError extends Error {
  readonly code = 'platform_ui_state_contract_invalid' as const

  constructor(message: string) {
    super(message)
    this.name = 'PlatformUiStateValidationError'
  }
}

function invalid(path: string, detail: string): never {
  throw new PlatformUiStateValidationError(`${path}: ${detail}`)
}

const { plainObject, exactKeys } = contractGuards(invalid)
const UNSAFE_KEY =
  /(?:^|[_-])(?:html|script|javascript|file|path|secret|token|password|credential|transcript|memory[_-]?body|provider[_-]?body|search[_-]?result|raw)(?:$|[_-])/iu
// Reasons are shell-authored presentation text. Domain payloads are cloned and
// bounded here, while their own runtime validators decide which inert strings
// are valid (card comments and titles legitimately contain routes and code).
const UNSAFE_TEXT =
  // The /i flag makes A-Z and a-z one range. Spelling both states the intent
  // where the flag sits eighty characters away, at the end of the pattern.
  // eslint-disable-next-line sonarjs/duplicates-in-character-class -- see above
  /<[^>]*>|\b(?:javascript|data|file)\s*:|(?:^|\s)(?:[A-Za-z]:[\\/]|\\\\)[^\s]+|(?:^|\s)\/[^\s/]+\/[^\s]+/iu
export const MAX_UI_STATE_REASON_LENGTH = 240
export const MAX_UI_STATE_STRING_LENGTH = 8192
/** Deterministic UTF-8 JSON ceiling for every validated ready/degraded payload. */
export const MAX_UI_STATE_PAYLOAD_BYTES = 256 * 1024

function reason(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_UI_STATE_REASON_LENGTH)
    invalid(path, 'expected bounded reason')
  if (UNSAFE_TEXT.test(value)) invalid(path, 'HTML/JS/file/path content is not allowed')
  return value
}

function optionalReason(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined
  return reason(value, path)
}

function timestamp(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    value.length > 96 ||
    !/^\d{4}-\d{2}-\d{2}T[^\s]{1,80}Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    invalid(path, 'expected ISO timestamp')
  return value
}

function clonePayload(
  value: unknown,
  path = 'state.payload',
  walk: WalkBudget = walkBudget(),
): unknown {
  if (walk.depth > MAX_CONTRACT_DEPTH) invalid(path, `payload exceeds depth ${MAX_CONTRACT_DEPTH}`)
  walk.nodes.count += 1
  if (walk.nodes.count > MAX_CONTRACT_NODES)
    invalid(path, `payload exceeds ${MAX_CONTRACT_NODES} values`)
  // Payload ownership stays with the caller; this boundary must not mutate it.
  if (Array.isArray(value)) return cloneArray(value, path, walk)
  if (value !== null && typeof value === 'object') return cloneObject(value, path, walk)
  return clonedScalar(value, path)
}

/** A copied list; a cycle is refused rather than followed. */
function cloneArray(value: unknown[], path: string, walk: WalkBudget): unknown[] {
  if (walk.seen.has(value)) invalid(path, 'cyclic payload is not allowed')
  walk.seen.add(value)
  const result = value.map((entry, index) =>
    clonePayload(entry, `${path}[${index}]`, descend(walk)),
  )
  walk.seen.delete(value)
  return result
}

/**
 * A copied object. Only a plain one is accepted, and each key has to survive the
 * length bound, the prototype-pollution list and the unsafe-content pattern
 * before it is carried over.
 */
function cloneObject(value: object, path: string, walk: WalkBudget): Record<string, unknown> {
  const object = value as Record<string, unknown>
  const prototype = Object.getPrototypeOf(object)
  if (prototype !== Object.prototype && prototype !== null)
    invalid(path, 'payload must contain plain JSON values')
  if (walk.seen.has(object)) invalid(path, 'cyclic payload is not allowed')
  walk.seen.add(object)
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(object)) {
    rejectUnsafePayloadKey(key, path)
    result[key] = clonePayload(entry, `${path}.${key}`, descend(walk))
  }
  walk.seen.delete(object)
  return result
}

/** The three ways a key can be refused, stated once for the one caller. */
function rejectUnsafePayloadKey(key: string, path: string): void {
  if (key.length > MAX_UI_STATE_STRING_LENGTH)
    invalid(
      `${path}.${key.slice(0, 32)}`,
      `payload string exceeds ${MAX_UI_STATE_STRING_LENGTH} characters`,
    )
  if (POLLUTION_KEYS.has(key)) invalid(`${path}.${key}`, 'prototype-pollution key is not allowed')
  if (UNSAFE_KEY.test(key)) invalid(`${path}.${key}`, 'provider/body/path content is not allowed')
}

/** A scalar, once the values JSON cannot carry have been refused. */
function clonedScalar(value: unknown, path: string): unknown {
  if (typeof value === 'number' && !Number.isFinite(value))
    invalid('state.payload', 'payload contains non-finite number')
  if (
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint' ||
    value === undefined
  )
    invalid('state.payload', 'payload must contain JSON values')
  if (typeof value === 'string' && value.length > MAX_UI_STATE_STRING_LENGTH)
    invalid(path, `payload string exceeds ${MAX_UI_STATE_STRING_LENGTH} characters`)
  return value
}

function canonicalPayloadJson(
  value: unknown,
  path = 'state.payload',
  depth = 0,
  seen = new WeakSet<object>(),
): string {
  if (depth > MAX_CONTRACT_DEPTH) invalid(path, `payload exceeds depth ${MAX_CONTRACT_DEPTH}`)
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) invalid(path, 'payload must contain JSON values')
    return encoded
  }
  if (Array.isArray(value)) return canonicalPayloadArray(value, path, depth, seen)
  if (typeof value === 'object') return canonicalPayloadObject(value, path, depth, seen)
  return invalid(path, 'payload must contain JSON values')
}

/** `[a,b,c]` with each entry canonical. */
function canonicalPayloadArray(
  value: unknown[],
  path: string,
  depth: number,
  seen: WeakSet<object>,
): string {
  if (seen.has(value)) invalid(path, 'cyclic payload is not allowed')
  seen.add(value)
  const parts = value.map((entry, index) =>
    canonicalPayloadJson(entry, `${path}[${index}]`, depth + 1, seen),
  )
  const encoded = `[${parts.join(',')}]`
  seen.delete(value)
  return encoded
}

/** `{"a":1}` with keys sorted, so one payload has one byte length. */
function canonicalPayloadObject(
  value: object,
  path: string,
  depth: number,
  seen: WeakSet<object>,
): string {
  const object = value as Record<string, unknown>
  if (seen.has(object)) invalid(path, 'cyclic payload is not allowed')
  seen.add(object)
  const parts = Object.keys(object)
    .sort()
    .map((key) => {
      const child = canonicalPayloadJson(object[key], `${path}.${key}`, depth + 1, seen)
      return `${JSON.stringify(key)}:${child}`
    })
  const encoded = `{${parts.join(',')}}`
  seen.delete(object)
  return encoded
}

function cloneAndBoundPayload(value: unknown, path: string): unknown {
  const cloned = clonePayload(value, path)
  const encoded = canonicalPayloadJson(cloned, path)
  const bytes = new TextEncoder().encode(encoded).byteLength
  if (bytes > MAX_UI_STATE_PAYLOAD_BYTES)
    invalid(
      path,
      `payload exceeds deterministic UTF-8 limit of ${MAX_UI_STATE_PAYLOAD_BYTES} bytes`,
    )
  return cloned
}

/**
 * `ready` carries a payload and nothing else.
 *
 * The payload key must be present even when its value is null: absent and
 * null-valued are different states, and only one of them is ready.
 */
function readyState<T>(object: Record<string, unknown>, path: string): PlatformUiState<T> {
  exactKeys(object, ['interface_version', 'status', 'payload'], path)
  if (!Object.prototype.hasOwnProperty.call(object, 'payload'))
    invalid(`${path}.payload`, 'ready state requires payload')
  return {
    interface_version: UI_STATE_INTERFACE,
    status: 'ready',
    payload: cloneAndBoundPayload(object.payload, `${path}.payload`) as T,
  }
}

/** `empty` may say why it is empty, and may equally say nothing. */
function emptyState<T>(object: Record<string, unknown>, path: string): PlatformUiState<T> {
  exactKeys(object, ['interface_version', 'status', 'reason'], path)
  const valueReason = optionalReason(object.reason, `${path}.reason`)
  return {
    interface_version: UI_STATE_INTERFACE,
    status: 'empty',
    ...(valueReason === undefined ? {} : { reason: valueReason }),
  }
}

/**
 * `error` and `unavailable` share one shape: a required reason and an optional
 * action to try again with. They differ in what the operator can do about it,
 * not in what the payload looks like.
 */
function failureState<T>(
  object: Record<string, unknown>,
  path: string,
  status: 'error' | 'unavailable',
): PlatformUiState<T> {
  exactKeys(object, ['interface_version', 'status', 'reason', 'retry_action'], path)
  const valueReason = reason(object.reason, `${path}.reason`)
  const retry =
    object.retry_action === undefined
      ? undefined
      : validateActionRef(object.retry_action, `${path}.retry_action`)
  return {
    interface_version: UI_STATE_INTERFACE,
    status,
    reason: valueReason,
    ...(retry === undefined ? {} : { retry_action: retry }),
  }
}

export function validatePlatformUiState<T = unknown>(
  value: unknown,
  path = 'state',
): PlatformUiState<T> {
  const object = plainObject(value, path)
  if (object.interface_version !== UI_STATE_INTERFACE)
    invalid(`${path}.interface_version`, `expected ${UI_STATE_INTERFACE}`)
  const status = object.status
  if (
    typeof status !== 'string' ||
    ![
      'degraded',
      'empty',
      'error',
      'loading',
      'permission-denied',
      'ready',
      'unavailable',
    ].includes(status)
  )
    invalid(`${path}.status`, 'unknown UI state')
  switch (status as PlatformUiStateName) {
    case 'loading': {
      exactKeys(object, ['interface_version', 'status'], path)
      return { interface_version: UI_STATE_INTERFACE, status: 'loading' }
    }
    case 'ready': {
      return readyState<T>(object, path)
    }
    case 'empty': {
      return emptyState<T>(object, path)
    }
    case 'error':
    case 'unavailable': {
      return failureState<T>(object, path, status as 'error' | 'unavailable')
    }
    case 'permission-denied': {
      exactKeys(object, ['interface_version', 'status', 'reason'], path)
      return {
        interface_version: UI_STATE_INTERFACE,
        status: 'permission-denied',
        reason: reason(object.reason, `${path}.reason`),
      }
    }
    case 'degraded': {
      exactKeys(
        object,
        ['interface_version', 'status', 'stale', 'payload', 'observed_at', 'reason'],
        path,
      )
      if (object.stale !== true)
        invalid(`${path}.stale`, 'degraded state requires explicit stale=true')
      if (!Object.prototype.hasOwnProperty.call(object, 'payload'))
        invalid(`${path}.payload`, 'degraded state requires stale payload')
      const degradedReason = optionalReason(object.reason, `${path}.reason`)
      return {
        interface_version: UI_STATE_INTERFACE,
        status: 'degraded',
        stale: true,
        payload: cloneAndBoundPayload(object.payload, `${path}.payload`) as T,
        observed_at: timestamp(object.observed_at, `${path}.observed_at`),
        ...(degradedReason === undefined ? {} : { reason: degradedReason }),
      }
    }
    default: {
      return invalid(`${path}.status`, 'unknown UI state')
    }
  }
}

export const uiLoading = <T = unknown>(): PlatformUiState<T> => ({
  interface_version: UI_STATE_INTERFACE,
  status: 'loading',
})
export const uiReady = <T>(payload: T): PlatformUiState<T> =>
  validatePlatformUiState<T>({
    interface_version: UI_STATE_INTERFACE,
    status: 'ready',
    payload,
  })
export const uiEmpty = <T = unknown>(reasonText?: string): PlatformUiState<T> =>
  validatePlatformUiState<T>(
    reasonText === undefined
      ? { interface_version: UI_STATE_INTERFACE, status: 'empty' }
      : { interface_version: UI_STATE_INTERFACE, status: 'empty', reason: reasonText },
  )
export const uiError = <T = unknown>(
  reasonText: string,
  retry_action?: ActionRef,
): PlatformUiState<T> =>
  validatePlatformUiState<T>(
    retry_action === undefined
      ? { interface_version: UI_STATE_INTERFACE, status: 'error', reason: reasonText }
      : {
          interface_version: UI_STATE_INTERFACE,
          status: 'error',
          reason: reasonText,
          retry_action,
        },
  )
export const uiUnavailable = <T = unknown>(
  reasonText: string,
  retry_action?: ActionRef,
): PlatformUiState<T> =>
  validatePlatformUiState<T>(
    retry_action === undefined
      ? {
          interface_version: UI_STATE_INTERFACE,
          status: 'unavailable',
          reason: reasonText,
        }
      : {
          interface_version: UI_STATE_INTERFACE,
          status: 'unavailable',
          reason: reasonText,
          retry_action,
        },
  )
export const uiPermissionDenied = <T = unknown>(reasonText: string): PlatformUiState<T> =>
  validatePlatformUiState<T>({
    interface_version: UI_STATE_INTERFACE,
    status: 'permission-denied',
    reason: reasonText,
  })
export const uiDegraded = <T>(
  payload: T,
  observedAt: string,
  reasonText?: string,
): PlatformUiState<T> =>
  validatePlatformUiState<T>(
    reasonText === undefined
      ? {
          interface_version: UI_STATE_INTERFACE,
          status: 'degraded',
          stale: true,
          payload,
          observed_at: observedAt,
        }
      : {
          interface_version: UI_STATE_INTERFACE,
          status: 'degraded',
          stale: true,
          payload,
          observed_at: observedAt,
          reason: reasonText,
        },
  )
