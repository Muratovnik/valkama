import { ref, watch } from 'vue'
import type { Ref } from 'vue'

import { subscribePlanning } from '@/shared/api/planningApi.ts'
import type { PlanningConnectionState, PlanningSpaceTarget } from '@/shared/api/planningApi.ts'
import type { PlanningReadModel } from '@/shared/api/planningModel.ts'
import { useLiveWorkStore } from '@/shared/stores/liveWorkStore.ts'

type Target = PlanningSpaceTarget | null

export function usePlanningSubscription(
  target: Ref<Target>,
  /** `returning` is true for the first frame after the connection dropped. */
  snapshot: (model: PlanningReadModel, returning: boolean) => void,
  agents: () => void,
  /**
   * The revision of the model the page holds for the target, read when the stream
   * opens: the stream does not send that model again.
   */
  since: () => string | undefined,
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
        subscribePlanning(
          selected,
          {
            agents: () => {
              if (current()) agents()
            },
            connection: (state) => {
              if (current()) connection.value = state
            },
            // The tab's one stream carries the side panel's frame too, so the shell opens none,
            // and the one it opened at the start closes once this has come.
            live: (frame) => {
              if (current()) useLiveWorkStore().acceptFromSpace(frame)
            },
            snapshot: (model) => {
              if (current()) snapshot(model, connection.value === 'reconnecting')
            },
          },
          since(),
        ),
      )
    },
    { immediate: true },
  )
  function reconnect() {
    attempt.value += 1
  }
  return { connection, reconnect }
}
