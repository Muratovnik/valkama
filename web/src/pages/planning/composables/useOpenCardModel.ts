/**
 * What the open card takes from the space's model rather than from its own read: its record as
 * the board has it, its epic's reference, which the card's record names only by id, and the
 * labels a label is attached from on it.
 */
import { computed } from 'vue'
import type { Ref } from 'vue'

import { provideSpaceLabels } from '@/features/work-item-labels/spaceLabels.ts'

import type { PlanningReadModel } from '@/shared/api/planningModel.ts'

export function useOpenCardModel(
  model: Ref<PlanningReadModel | null | undefined>,
  open: Ref<string | null | undefined>,
) {
  const openRecord = computed(() =>
    model.value?.work_items.find((item) => item.reference === open.value),
  )
  /** The open item's epic, by reference: the card's facts name it. */
  const parentReference = computed(() => {
    const parent = openRecord.value?.parent_id
    return model.value?.work_items.find((item) => item.work_item_id === parent)?.reference ?? null
  })
  provideSpaceLabels(() => model.value?.work_items)
  return { openRecord, parentReference }
}
