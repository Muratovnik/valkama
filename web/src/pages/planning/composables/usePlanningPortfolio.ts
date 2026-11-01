import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { fetchPlatformPlanning } from '@/shared/api/platformPlanningApi.ts'
import type { PlatformPlanningReady } from '@/shared/api/platformPlanningTypes.ts'
import type { OperatingScope } from '@/shared/api/platformRoute.ts'
import { uiDegraded, uiError, uiLoading } from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import { failureMessage, typedFailure } from '@/shared/api/typedFailure.ts'

export function usePlanningPortfolio(scope: () => OperatingScope) {
  const { t } = useI18n()
  const state = ref<PlatformUiState<PlatformPlanningReady>>(uiLoading())
  let generation = 0
  /** The scope whose directory is on screen, so a read of the same scope is a refresh. */
  let shown = ''
  function invalidate() {
    generation += 1
  }
  /**
   * Read the directory. A new scope starts from loading; a refresh of the one
   * on screen keeps what it shows — its projects marked stale, or its empty
   * state — until the answer lands, and a refresh that fails keeps the
   * projects with the failure said above them. It used to start every read
   * from loading, so each refresh replaced the whole directory with the
   * loading panel and built it again.
   */
  async function load() {
    const current = ++generation
    const asked = scope()
    const key = JSON.stringify(asked)
    const same = key === shown
    const held = same && 'payload' in state.value ? state.value.payload : undefined
    const at = new Date().toISOString()
    if (!same) {
      shown = ''
      state.value = uiLoading()
    } else if (held !== undefined) state.value = uiDegraded(held, at)
    try {
      const payload = await fetchPlatformPlanning(asked)
      if (current !== generation) return
      state.value = payload.state
      shown = key
    } catch (error) {
      if (current !== generation) return
      const message = failureMessage(typedFailure(error))
      const reason = t(message.key, message.params ?? {})
      state.value = held === undefined ? uiError(reason) : uiDegraded(held, at, reason)
    }
  }
  onBeforeUnmount(invalidate)
  return { state, load, invalidate }
}
