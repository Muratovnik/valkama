import { computed, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import { useI18n } from 'vue-i18n'

import { useWorkItemReferencePreview } from '@/entities/work-item/composables/useWorkItemReferencePreview.ts'
import { waitingOn } from '@/entities/work-item/utils/waiting.ts'

import type { PlanningReadModel } from '@/shared/api/planningModel.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import { provideReferenceLinks, referenceSpaceKey } from '@/shared/lib/referenceLinks.ts'

/**
 * The open space's layer of reference links.
 *
 * A reference to this space links only to an item the space holds; one it does
 * not hold is text, whatever its shape, because the read model is the whole
 * space and a number missing from it is missing. Another space's reference,
 * and everything that is not a work item, is the shell's to answer. While the
 * space is still loading, the shell answers for it too.
 *
 * What a reference shows on hover is what the model holds, read afresh each time
 * it is drawn, so it needs no request and follows the stream while it is open.
 */
export function usePlanningReferenceLinks(
  space: MaybeRefOrGetter<PlanningSpaceRef | undefined>,
  model: MaybeRefOrGetter<PlanningReadModel | null>,
  open: (reference: string) => void,
) {
  const { t } = useI18n()
  const previewOf = useWorkItemReferencePreview()
  const held = computed(
    () => new Map(toValue(model)?.work_items.map((item) => [item.reference, item]) ?? []),
  )
  const waiting = computed(() => {
    const read = toValue(model)
    return read ? waitingOn(read.links, read.work_items) : new Map<string, string>()
  })
  provideReferenceLinks((reference, parent) => {
    const bound = toValue(space)
    const owned =
      reference.kind === 'work-item' &&
      bound !== undefined &&
      toValue(model) !== null &&
      referenceSpaceKey(reference.value) === bound.space_key
    if (!owned) return parent(reference)
    if (!held.value.has(reference.value)) return null
    return {
      title: t('textLinks.openItem', { reference: reference.value }),
      open: () => open(reference.value),
      preview: previewOf(() => {
        const item = held.value.get(reference.value) ?? null
        return {
          reference: reference.value,
          item,
          waitingOn: item ? waiting.value.get(item.work_item_id) : null,
        }
      }),
    }
  })
}
