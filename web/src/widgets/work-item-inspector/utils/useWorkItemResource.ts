import { computed, onBeforeUnmount, ref } from 'vue'
import type { Ref } from 'vue'

import { fetchWorkItem } from '@/shared/api/planningApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { planningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import { uiReady } from '@/shared/api/platformUiState.ts'
import {
  beginResource,
  cancelResource,
  createResource,
  rejectResource,
  resolveResource,
} from '@/shared/api/resourceState.ts'
import type { ResourceState } from '@/shared/api/resourceState.ts'
import { resourceUiState } from '@/shared/api/resourceUiState.ts'
import type { Observed } from '@/shared/api/resourceUiState.ts'
import { typedFailure } from '@/shared/api/typedFailure.ts'
import type { TypedFailure } from '@/shared/api/typedFailure.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'

/**
 * One inspector record, keyed so refreshes retain only the same work item.
 *
 * A record the service says is not there is `missing`, not a failed read: there
 * is nothing to retry and nothing to show. That holds for a refresh too — an
 * item deleted while its card is open drops the last answer rather than keeping
 * a card for a record that no longer exists, whose writes would all be refused.
 */
export function useWorkItemResource(
  reference: () => string,
  target: () => { project: string; resource: PlanningSpaceEntityRef },
  failureReason: (failure: TypedFailure) => string,
) {
  const resource = ref(createResource<Observed<WorkItem>>()) as Ref<
    ResourceState<Observed<WorkItem>>
  >
  const state = computed(() => resourceUiState(resource.value, { failureReason }))
  const missing = computed(() => resource.value.failure?.code === 'not_found')
  const item = computed(() =>
    !missing.value && 'payload' in state.value ? state.value.payload : null,
  )
  const retryable = computed(() => resource.value.failure?.retryable ?? false)

  async function load() {
    const current = reference()
    const scope = target()
    const key = JSON.stringify([scope.project, scope.resource.resource_id, current])
    resource.value = beginResource(resource.value, key)
    const generation = resource.value.generation
    try {
      const space = planningSpaceRef(scope.resource)
      if (space === undefined) throw new Error('Exact Planning space is required')
      const record = await fetchWorkItem(current, { project: scope.project, space })
      resource.value = resolveResource(resource.value, generation, key, {
        at: new Date().toISOString(),
        state: uiReady(record),
      })
    } catch (error) {
      resource.value = rejectResource(
        resource.value,
        generation,
        key,
        typedFailure(error, 'work_item_request_failed'),
      )
    }
  }

  onBeforeUnmount(() => {
    resource.value = cancelResource(resource.value)
  })
  return { item, load, missing, retryable, state }
}
