import { onScopeDispose, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import type { WorkItem, WorkItemBrief } from '@/shared/api/planningModel.ts'
import { fetchPlanningWorkItemBrief } from '@/shared/api/platformPlanningApi.ts'
import { typedFailure } from '@/shared/api/typedFailure.ts'
import { referenceSpaceKey } from '@/shared/lib/referenceLinks.ts'

/**
 * The goal a task stands in, as its read ended: read, gone (the task stands under nothing now, or
 * the item over it is no longer there), or failed.
 */
export type QuestionGoal =
  { item: WorkItemBrief; status: 'ready' } | { status: 'failed' } | { status: 'gone' }

/**
 * The goal of the task a question asks about, with its conditions: read by the reference the
 * task's card names it by (`parent`), in the space that reference names of the question's store,
 * by the exact read of one item in its brief form. `parent_id` alone cannot be read there.
 *
 * It is read once the task's card has arrived, so it follows that card's lazy read. A read that
 * fails, or finds no goal, says so (`failed`, `gone`); the question is answered all the same.
 * Null while there is nothing to say: no card yet, a kind that shows no goal, or a card from a
 * server that does not name its parent.
 */
export function useQuestionGoal(
  entry: () => InputRequestEntry,
  task: Readonly<Ref<WorkItem | null>>,
  wanted: () => boolean,
) {
  const goal = shallowRef<QuestionGoal | null>(null)
  let reading: AbortController | null = null
  watch(
    () => (wanted() ? task.value?.parent : undefined),
    async (parent) => {
      reading?.abort()
      goal.value = null
      if (parent === undefined) return
      if (parent === null) {
        goal.value = { status: 'gone' }
        return
      }
      const own = new AbortController()
      reading = own
      const space_ref = {
        data_scope_id: entry().target.space_ref.data_scope_id,
        space_key: referenceSpaceKey(parent),
      }
      try {
        const read = await fetchPlanningWorkItemBrief({ reference: parent, space_ref }, own.signal)
        goal.value =
          read.state.status === 'ready'
            ? { item: read.state.payload.work_item, status: 'ready' }
            : { status: 'failed' }
      } catch (error) {
        if (own.signal.aborted) return
        goal.value = { status: typedFailure(error).status === 404 ? 'gone' : 'failed' }
      }
    },
    { immediate: true },
  )
  onScopeDispose(() => reading?.abort())
  return goal
}
