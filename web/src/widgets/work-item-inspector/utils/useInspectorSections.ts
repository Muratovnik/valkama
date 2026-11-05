import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { provideMemorySource } from '@/widgets/work-item-inspector/utils/memorySource.ts'

import { useSettingsStore } from '@/shared/stores/settingsStore.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import { useTabIds } from '@/shared/ui/tabIds.ts'

export type InspectorSection = 'activity' | 'execution' | 'memory' | 'overview' | 'relations'

/**
 * Which section of a card is shown, the strip that chooses it, and the body's
 * scroll that follows the choice.
 *
 * Execution exists only for an item of the primary store, and only once the owner
 * has turned its tab on, so the strip offers it only then, and a card that stops
 * offering it steps off it. The setting is read before the card draws anything.
 *
 * A section shows the moment it is chosen, which is what lets the arrows choose as they
 * move: what one reads is read with the card, as its attempts are, and Memory's source
 * with them (`memorySource`).
 */
export function useInspectorSections(
  writable: () => boolean,
  scrollToStart: () => void,
  projectId: () => string,
) {
  const { t } = useI18n()
  const { settings } = storeToRefs(useSettingsStore())
  const offersExecution = computed(() => writable() && settings.value.executionTab)
  const section = ref<InspectorSection>('overview')
  provideMemorySource(projectId)

  // Every tab starts at its own top. The body is one scroller, so a tab opened
  // after reading far down another used to open at that same depth.
  watch(section, scrollToStart)

  const sections = computed<ChoiceOption[]>(() => [
    { value: 'overview' as const, label: t('workItem.overview') },
    ...(offersExecution.value
      ? [{ value: 'execution' as const, label: t('workItem.section.execution') }]
      : []),
    { value: 'memory' as const, label: t('workItem.section.memory') },
    { value: 'relations' as const, label: t('workItem.relations') },
    { value: 'activity' as const, label: t('workItem.activity') },
  ])

  /** Off Execution once the card no longer offers it. */
  function leaveUnoffered() {
    if (!offersExecution.value && section.value === 'execution') section.value = 'overview'
  }
  watch(offersExecution, leaveUnoffered)

  /**
   * The strip's model: any section name it offers, read back as one. A card coming back
   * by Back writes here too, and the section it was left in may be off by now.
   */
  const shownSection = computed({
    get: () => section.value as string,
    set: (value: string) => {
      section.value = value as InspectorSection
      leaveUnoffered()
    },
  })

  return { offersExecution, section, sections, shownSection, tabs: useTabIds() }
}
