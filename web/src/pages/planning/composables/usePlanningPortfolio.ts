import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { fetchPlatformPlanning } from '@/shared/api/platformPlanningApi.ts'
import type { PlatformPlanningReady } from '@/shared/api/platformPlanningTypes.ts'
import type { OperatingScope } from '@/shared/api/platformRoute.ts'
import { uiError, uiLoading } from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import { failureMessageKey, typedFailure } from '@/shared/api/typedFailure.ts'

export function usePlanningPortfolio(scope: () => OperatingScope) {
  const { t } = useI18n()
  const state = ref<PlatformUiState<PlatformPlanningReady>>(uiLoading())
  let generation = 0
  function invalidate() {
    generation += 1
  }
  async function load() {
    const current = ++generation
    state.value = uiLoading()
    try {
      const payload = await fetchPlatformPlanning(scope())
      if (current === generation) state.value = payload.state
    } catch (error) {
      if (current === generation) state.value = uiError(t(failureMessageKey(typedFailure(error))))
    }
  }
  onBeforeUnmount(invalidate)
  return { state, load, invalidate }
}
