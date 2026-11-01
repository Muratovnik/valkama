import { computed, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import { useI18n } from 'vue-i18n'

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
 */
export function usePlanningReferenceLinks(
  space: MaybeRefOrGetter<PlanningSpaceRef | undefined>,
  model: MaybeRefOrGetter<PlanningReadModel | null>,
  open: (reference: string) => void,
) {
  const { t } = useI18n()
  const held = computed(
    () => new Set(toValue(model)?.work_items.map((item) => item.reference) ?? []),
  )
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
    }
  })
}
