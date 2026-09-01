/** Project one Skills read into the product's shared loading/error grammar. */

import { uiEmpty, uiError, uiLoading } from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import type { ResourceState } from '@/shared/api/resourceState.ts'
import type { TypedFailure } from '@/shared/api/typedFailure.ts'

/** One accepted answer and when it became visible to the operator. */
export interface SkillObservation<T> {
  at: string
  value: T
}

interface SkillResourceOptions<T> {
  emptyReason?: string
  empty?: (payload: T) => boolean
  failureReason: (failure: TypedFailure) => string
}

/**
 * Keep a potentially large Skills payload by reference while expressing its UI state.
 *
 * Skills inventory and comparison payloads are already validated at their API
 * boundary and may approach their own bounded response ceilings. Re-validating
 * and cloning them through the generic shell payload boundary on every render
 * would turn a view projection into a second, smaller transport contract.
 */
export function skillResourceState<T>(
  resource: ResourceState<SkillObservation<T>>,
  key: string,
  options: SkillResourceOptions<T>,
): PlatformUiState<T> {
  const observed = resource.key === key ? resource.data : null
  if (observed === null) {
    return resource.failure === null
      ? uiLoading()
      : uiError(options.failureReason(resource.failure))
  }

  if (resource.status === 'ready') {
    if (options.empty?.(observed.value)) return uiEmpty(options.emptyReason)
    return {
      interface_version: 'valkama-ui-state',
      status: 'ready',
      payload: observed.value,
    }
  }

  return {
    interface_version: 'valkama-ui-state',
    status: 'degraded',
    stale: true,
    payload: observed.value,
    observed_at: observed.at,
    ...(resource.failure === null ? {} : { reason: options.failureReason(resource.failure) }),
  }
}
