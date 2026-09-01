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
  if (state === null || typeof state !== 'object' || !('status' in state)) return undefined
  return state as PlatformUiState
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
  if (state?.status === 'unavailable' && state.retry_action === undefined)
    return { code: 'dependency_unavailable', status, retryable: false }
  if (sourceCode.endsWith('_contract_invalid') || sourceCode === 'contract_invalid')
    return { code: 'contract_invalid', status, retryable: true }
  return { code: stableCode(sourceCode, 'unknown_failure'), status, retryable: true }
}

export function responseFailure(response: Response, fallbackCode = 'request_failed'): TypedFailure {
  if (response.status === 401 || response.status === 403)
    return { code: 'permission_denied', status: response.status, retryable: false }
  if (response.status === 404 || response.status === 501)
    return { code: 'dependency_unavailable', status: response.status, retryable: false }
  return { code: fallbackCode, status: response.status, retryable: response.status >= 500 }
}

const KNOWN_FAILURE_KEYS: Readonly<Record<string, string>> = {
  contract_invalid: 'platform.failures.contractInvalid',
  dependency_unavailable: 'platform.failures.dependencyUnavailable',
  mutation_failed: 'platform.failures.mutationFailed',
  permission_denied: 'platform.failures.permissionDenied',
  request_failed: 'platform.failures.requestFailed',
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

export function failureMessageKey(failure: TypedFailure): string {
  return failureMessage(failure).key
}
