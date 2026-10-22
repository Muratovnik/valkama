import { ref, watch } from 'vue'
import type { Ref } from 'vue'

import { subscribePlanning } from '@/shared/api/planningApi.ts'
import type { PlanningConnectionState } from '@/shared/api/planningApi.ts'
import type { PlanningReadModel } from '@/shared/api/planningModel.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'

type Target = ({ project: string } & PlanningSpaceRef) | null

export function usePlanningSubscription(
  target: Ref<Target>,
  snapshot: (model: PlanningReadModel) => void,
) {
  const connection = ref<PlanningConnectionState>('connecting')
  const attempt = ref(0)
  watch(
    [() => JSON.stringify(target.value), attempt],
    ([key], _previous, cleanup) => {
      const selected = target.value
      connection.value = 'connecting'
      if (selected === null) return
      const current = () => key === JSON.stringify(target.value)
      cleanup(
        subscribePlanning(selected, {
          connection: (state) => {
            if (current()) connection.value = state
          },
          snapshot: (model) => {
            if (current()) snapshot(model)
          },
        }),
      )
    },
    { immediate: true },
  )
  function reconnect() {
    attempt.value += 1
  }
  return { connection, reconnect }
}
