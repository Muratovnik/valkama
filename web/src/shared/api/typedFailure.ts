/** Stable, presentation-safe failures at the browser API boundary. */

import type { PlatformUiState } from '@/shared/api/platformUiState.ts'

export interface TypedFailure {
  code: string
  retryable: boolean
  status: number | null
  detail?: string
}

export interface FailureMessage {
  key: string
  params?: { code: string }
}

const CODE_LIMIT = 64
const SAFE_CODE = /^[a-z][a-z0-9_-]*$/u

function stableCode(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.toLowerCase().slice(0, CODE_LIMIT)
  return SAFE_CODE.test(normalized) ? normalized : fallback
}

function numericStatus(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : null
}

function stateFrom(error: unknown): PlatformUiState | undefined {
  if (!(error instanceof Error) || !('state' in error)) return undefined
  const state = (error as Error & { state?: unknown }).state
  return state === null || typeof state !== 'object' || !('status' in state)
    ? undefined
    : (state as PlatformUiState)
}

function isTypedFailure(value: unknown): value is TypedFailure {
  if (value === null || typeof value !== 'object') return false
  const failure = value as Partial<TypedFailure>
  return (
    typeof failure.code === 'string' &&
    (failure.status === null || typeof failure.status === 'number') &&
    typeof failure.retryable === 'boolean'
  )
}

/**
 * An error envelope that answers `unavailable` with no ui state behind it means
 * what that state means: the record is not there (404), or what answers for it is down.
 */
function unavailableAnswer(status: number | null): TypedFailure {
  return status === 404
    ? { code: 'not_found', status, retryable: false }
    : { code: 'dependency_unavailable', status, retryable: false }
}

export function typedFailure(error: unknown, fallbackCode = 'request_failed'): TypedFailure {
  if (isTypedFailure(error)) {
    return {
      code: stableCode(error.code, 'unknown_failure'),
      status: numericStatus(error.status),
      retryable: error.retryable,
      ...(error.detail === undefined ? {} : { detail: stableCode(error.detail, 'unknown_detail') }),
    }
  }

  const state = stateFrom(error)
  const status =
    error instanceof Error && 'status' in error
      ? numericStatus((error as Error & { status?: unknown }).status)
      : null
  const sourceCode =
    error instanceof Error && 'code' in error
      ? stableCode((error as Error & { code?: unknown }).code, fallbackCode)
      : fallbackCode

  if (state?.status === 'permission-denied' || status === 401 || status === 403)
    return { code: 'permission_denied', status, retryable: false }
  // The state grammar has no word for "not there", so an exact read the service
  // answers 404 says `unavailable`; the status is what tells it from an outage.
  if (state?.status === 'unavailable' && status === 404)
    return { code: 'not_found', status, retryable: false }
  if (state?.status === 'unavailable' && state.retry_action === undefined)
    return { code: 'dependency_unavailable', status, retryable: false }
  if (sourceCode === 'unavailable') return unavailableAnswer(status)
  // The service says the thing named is not there; asking again finds nothing new.
  if (sourceCode === 'not_found') return { code: 'not_found', status, retryable: false }
  if (sourceCode.endsWith('_contract_invalid') || sourceCode === 'contract_invalid')
    return { code: 'contract_invalid', status, retryable: true }
  return { code: stableCode(sourceCode, 'unknown_failure'), status, retryable: true }
}

const KNOWN_FAILURE_KEYS: Readonly<Record<string, string>> = {
  connection_lost: 'connection.readFailed',
  contract_invalid: 'platform.failures.contractInvalid',
  dependency_unavailable: 'platform.failures.dependencyUnavailable',
  mutation_failed: 'platform.failures.mutationFailed',
  not_found: 'platform.failures.notFound',
  permission_denied: 'platform.failures.permissionDenied',
  request_failed: 'platform.failures.requestFailed',
  request_timeout: 'platform.failures.requestTimeout',
  session_feed_failed: 'platform.failures.sessionFeedFailed',
  sessions_request_failed: 'platform.failures.sessionsRequestFailed',
  stream_disconnected: 'platform.failures.streamDisconnected',
}

/** A localized-copy descriptor; unknown failures expose only a bounded technical code. */
export function failureMessage(failure: TypedFailure): FailureMessage {
  const key = KNOWN_FAILURE_KEYS[failure.code]
  return key === undefined
    ? {
        key: 'platform.failures.unknown',
        params: { code: stableCode(failure.code, 'unknown_failure') },
      }
    : { key }
}

/**
 * The copy's key alone, for a reader that translates it later. A key cannot carry
 * the technical code, so an unknown failure reads as the generic one rather than
 * as the unknown sentence with its code left empty.
 */
export function failureMessageKey(failure: TypedFailure): string {
  const message = failureMessage(failure)
  return message.params === undefined ? message.key : 'platform.failures.requestFailed'
}
