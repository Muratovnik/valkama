/** Project one keyed stale-while-refresh resource into the shared UI grammar. */

import {
  uiDegraded,
  uiEmpty,
  uiError,
  uiLoading,
  uiPermissionDenied,
  uiUnavailable,
} from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import type { ResourceState } from '@/shared/api/resourceState.ts'
import { failureMessageKey } from '@/shared/api/typedFailure.ts'
import type { TypedFailure } from '@/shared/api/typedFailure.ts'

/** One accepted answer and the time at which it became observable. */
export interface Observed<T> {
  at: string
  state: PlatformUiState<T>
}

interface ProjectionOptions<T> {
  emptyReason?: string
  empty?: (payload: T) => boolean
  failureReason?: (failure: TypedFailure) => string
}

function coldFailure<T>(failure: TypedFailure, reason: string): PlatformUiState<T> {
  if (failure.code === 'permission_denied') return uiPermissionDenied(reason)
  if (!failure.retryable && failure.code === 'dependency_unavailable') return uiUnavailable(reason)
  return uiError(reason)
}

export function resourceUiState<T>(
  resource: ResourceState<Observed<T>>,
  options: ProjectionOptions<T> = {},
): PlatformUiState<T> {
  const observed = resource.data
  const failureReason = options.failureReason ?? failureMessageKey
  if (observed === null) {
    return resource.failure === null
      ? uiLoading()
      : coldFailure(resource.failure, failureReason(resource.failure))
  }

  if (resource.status === 'ready') {
    if (
      observed.state.status === 'ready' &&
      options.empty !== undefined &&
      options.empty(observed.state.payload)
    )
      return uiEmpty(options.emptyReason)
    return observed.state
  }

  if (observed.state.status === 'ready') {
    return uiDegraded(
      observed.state.payload,
      observed.at,
      resource.failure === null ? undefined : failureReason(resource.failure),
    )
  }

  return observed.state
}
