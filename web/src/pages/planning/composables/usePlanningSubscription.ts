import { ref, watch } from 'vue'
import type { Ref } from 'vue'

import { subscribePlanning } from '@/shared/api/planningApi.ts'
import type { PlanningConnectionState } from '@/shared/api/planningApi.ts'
import type { PlanningReadModel } from '@/shared/api/planningModel.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import { useLiveWorkStore } from '@/shared/stores/liveWorkStore.ts'

type Target = ({ project: string } & PlanningSpaceRef) | null

export function usePlanningSubscription(
  target: Ref<Target>,
  /** `returning` is true for the first frame after the connection dropped. */
  snapshot: (model: PlanningReadModel, returning: boolean) => void,
  agents: () => void,
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
          agents: () => {
            if (current()) agents()
          },
          connection: (state) => {
            if (current()) connection.value = state
          },
          // The tab's one stream carries the side panel's frame too, so the shell opens none.
          live: (frame) => {
            if (current()) useLiveWorkStore().accept(frame)
          },
          snapshot: (model) => {
            if (current()) snapshot(model, connection.value === 'reconnecting')
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
