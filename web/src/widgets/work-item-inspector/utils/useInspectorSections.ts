import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'

export type InspectorSection = 'activity' | 'execution' | 'memory' | 'overview' | 'relations'

/**
 * Which section of a card is shown, the strip that chooses it, and the body's
 * scroll that follows the choice.
 *
 * Execution exists only for an item of the primary store, so the strip offers it
 * only there, and a card that stops being writable steps off it.
 */
export function useInspectorSections(writable: () => boolean, scrollToTop: () => void) {
  const { t } = useI18n()
  const section = ref<InspectorSection>('overview')

  // Every tab starts at its own top. The body is one scroller, so a tab opened
  // after reading far down another used to open at that same depth.
  watch(section, scrollToTop)

  const sections = computed<ChoiceOption[]>(() => [
    { value: 'overview' as const, label: t('workItem.overview') },
    ...(writable()
      ? [{ value: 'execution' as const, label: t('workItem.section.execution') }]
      : []),
    { value: 'memory' as const, label: t('workItem.section.memory') },
    { value: 'relations' as const, label: t('workItem.relations') },
    { value: 'activity' as const, label: t('workItem.activity') },
  ])

  /** The strip's model: any section name it offers, read back as one. */
  const shownSection = computed({
    get: () => section.value as string,
    set: (value: string) => {
      section.value = value as InspectorSection
    },
  })

  /** Off Execution once the card can no longer read it. */
  function leaveUnreadable() {
    if (!writable() && section.value === 'execution') section.value = 'overview'
  }

  return { leaveUnreadable, section, sections, shownSection }
}
