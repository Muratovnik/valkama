/**
 * What the open card takes from the space's model rather than from its own read: its record as
 * the board has it, its parent's reference and kind, which the card's record names only by id,
 * and the labels a label is attached from on it.
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
  /**
   * The open item's parent as the model holds it, with no read of its own: the card's facts
   * name it by its reference and draw it by its kind.
   */
  const parent = computed(() => {
    const id = openRecord.value?.parent_id
    const found = id && model.value?.work_items.find((item) => item.work_item_id === id)
    return found ? { reference: found.reference, kind: found.kind } : null
  })
  provideSpaceLabels(() => model.value?.work_items)
  return { openRecord, parent }
}
