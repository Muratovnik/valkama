/**
 * A task's cost of all time in a value's side panel: the read its card makes (`useWorkItemUsage`,
 * the item's own work by its reference) said as the card's line says a cost (`itemCost`), so the
 * panel and the card never give two figures for one question. Read again when the page's read is,
 * no sooner than the card would. The figure keeps its row while the read waits, with no words yet,
 * and says so when it failed; a value that is no task has none and asks nothing.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useUsageWords } from '@/widgets/work-item-inspector/utils/useUsageWords.ts'
import { useWorkItemUsage } from '@/widgets/work-item-inspector/utils/useWorkItemUsage.ts'

export function useTaskAllTime(options: {
  /** When the page's answer was asked for: a new one reads this again. */
  readAt: () => Date
  /** The task's reference; null for a value that is no task, or one with no card. */
  reference: () => string | null
}) {
  const { t } = useI18n()
  const { itemCost } = useUsageWords()
  const read = useWorkItemUsage(() => {
    const reference = options.reference()
    return reference ? { id: reference, scope: 'item' } : null
  }, options.readAt)
  return computed(() => {
    if (!options.reference()) return null
    const usage = read.usage.value
    let text = ''
    if (usage) text = itemCost(usage) || t('analytics.figures.noPrice')
    else if (read.failed.value) text = t('analytics.detail.allTimeFailed')
    return { key: 'all-time', name: t('analytics.detail.allTime'), text }
  })
}
