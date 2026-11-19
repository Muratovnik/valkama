/**
 * A task's figures of all time in a value's side panel: the agents' time and the cost, from the
 * read its card makes (`useWorkItemUsage`) by the card's rule (`usageTarget`) and in the card's
 * words for them (`agentTime`, `itemCost`), so the panel and the card never give two figures, or
 * two names, for one question. An epic's are its whole scope's, as on its card, and its heading
 * says so as the card's line does, «on the epic»; any other task's are its own work. The agents'
 * time is the sum of each agent's, the time Analytics counts, and never the time on the clock the
 * card's line starts with. Read again when the page's read is, no sooner than the card would. The
 * figures keep their rows while the read waits, with no words yet, and one row says so when it
 * failed. A value that is no task, and a task the read does not reach, where its card asks
 * nothing either (`injectUsageReach`), have no figures and ask nothing.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useUsageWords } from '@/widgets/work-item-inspector/utils/useUsageWords.ts'
import {
  injectUsageReach,
  usageTarget,
  useWorkItemUsage,
} from '@/widgets/work-item-inspector/utils/useWorkItemUsage.ts'

export function useTaskAllTime(options: {
  /** The task, whether it is an epic; null for a value that is no task, or one with no card. */
  item: () => { epic: boolean; reference: string } | null
  /** When the page's answer was asked for: a new one reads this again. */
  readAt: () => Date
}) {
  const { t } = useI18n()
  const { agentTime, itemCost } = useUsageWords()
  const reaches = injectUsageReach()
  const target = () => {
    const item = options.item()
    return item ? usageTarget({ ...item, readable: reaches() }) : null
  }
  const read = useWorkItemUsage(target, options.readAt)

  function figures() {
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
  }

  return computed(() => {
    const asked = target()
    if (!asked) return null
    const title = t(
      asked.scope === 'epic' ? 'analytics.detail.allTimeEpic' : 'analytics.detail.allTime',
    )
    return { title, figures: figures() }
  })
}
