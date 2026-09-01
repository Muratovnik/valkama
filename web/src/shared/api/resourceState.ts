import type { TypedFailure } from '@/shared/api/typedFailure.ts'

/**
 * Small stale-while-refresh resource state machine used by shell read models.
 *
 * A same-key refresh never clears `data`. Switching keys isolates the new
 * resource immediately so content from the previous key cannot leak. Callers
 * compare the returned object identity to reject stale callbacks without
 * mutating their existing read model.
 */

type ResourceStatus = 'idle' | 'loading' | 'refreshing' | 'ready' | 'error'

export interface ResourceState<T> {
  data: T | null
  /** Legacy display text for consumers not yet migrated to the typed boundary. */
  error: string | null
  failure: TypedFailure | null
  generation: number
  key: string | null
  pendingKey: string | null
  status: ResourceStatus
}

export function createResource<T>(
  data: T | null = null,
  key: string | null = null,
): ResourceState<T> {
  return {
    data,
    key,
    pendingKey: null,
    status: data === null ? 'idle' : 'ready',
    error: null,
    failure: null,
    generation: 0,
  }
}

/** Begin a new request while retaining the previous payload, if any. */
export function beginResource<T>(state: ResourceState<T>, key: string): ResourceState<T> {
  const sameKey = state.key === key
  return {
    ...state,
    data: sameKey ? state.data : null,
    key: sameKey ? state.key : null,
    pendingKey: key,
    status: sameKey && state.data !== null ? 'refreshing' : 'loading',
    error: null,
    failure: null,
    generation: state.generation + 1,
  }
}

/** Invalidate callbacks for a stream that is being closed without clearing data. */
export function cancelResource<T>(state: ResourceState<T>): ResourceState<T> {
  return {
    ...state,
    pendingKey: null,
    status: state.data === null ? 'idle' : 'ready',
    error: null,
    failure: null,
    generation: state.generation + 1,
  }
}

function accepts<T>(state: ResourceState<T>, generation: number, key: string): boolean {
  if (state.generation !== generation) return false
  // A pending key is authoritative during a refresh.  Without one, an
  // already committed stream may continue to publish updates for its key.
  return state.pendingKey === key || (state.pendingKey === null && state.key === key)
}

/** Commit one response atomically, ignoring callbacks from older generations. */
export function resolveResource<T>(
  state: ResourceState<T>,
  generation: number,
  key: string,
  data: T,
): ResourceState<T> {
  if (!accepts(state, generation, key)) return state
  return {
    ...state,
    data,
    key,
    pendingKey: null,
    status: 'ready',
    error: null,
    failure: null,
  }
}

/** Keep stale data visible when a refresh fails; only the pending intent is reverted. */
export function rejectResource<T>(
  state: ResourceState<T>,
  generation: number,
  key: string,
  error: string | TypedFailure,
): ResourceState<T> {
  // A disconnect after the first payload is a reconnecting transport state,
  // not a failed resource transition.  Only an unresolved pending request may
  // roll its selection back.
  if (state.generation !== generation || state.pendingKey !== key) return state
  const failure = typeof error === 'string' ? null : error
  return {
    ...state,
    pendingKey: null,
    status: 'error',
    error: typeof error === 'string' ? error : error.code,
    failure,
  }
}

export function resourceSelection<T>(state: ResourceState<T>): string {
  return state.pendingKey ?? state.key ?? ''
}
