/**
 * A task's figures of all time in a value's side panel: the agents' time and the cost, from the
 * read its card makes (`useWorkItemUsage`, the item's own work by its reference) and in the
 * card's words for them (`agentTime`, `itemCost`), so the panel and the card never give two
 * figures, or two names, for one question. The agents' time is the sum of each agent's, the time
 * Analytics counts, and never the time on the clock the card's line starts with. Read again when
 * the page's read is, no sooner than the card would. The figures keep their rows while the read
 * waits, with no words yet, and one row says so when it failed; a value that is no task has none
 * and asks nothing.
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
  const { agentTime, itemCost } = useUsageWords()
  const read = useWorkItemUsage(() => {
    const reference = options.reference()
    return reference ? { id: reference, scope: 'item' } : null
  }, options.readAt)
  return computed(() => {
    if (!options.reference()) return null
    const usage = read.usage.value
    if (!usage && read.failed.value)
      return [{ key: 'failed', name: t('analytics.detail.allTimeFailed'), text: '' }]
    return [
      {
        key: 'agents',
        name: t('workItem.usage.allAgents'),
        text: usage ? agentTime(usage) || t('workItem.usage.onTheSide') : '',
      },
      {
        key: 'cost',
        name: t('workItem.usage.cost'),
        text: usage ? itemCost(usage) || t('analytics.figures.noPrice') : '',
      },
    ]
  })
}
