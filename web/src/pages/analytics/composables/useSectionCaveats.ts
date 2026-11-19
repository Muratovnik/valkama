/**
 * The caveats each section of the Analytics page says once, in the «ⓘ» of its heading, and
 * nowhere else on the page: that the agent time of agents working at once adds up, so it may be
 * longer than the period, that a cost is an estimate at API prices and not a bill, what the
 * tokens count and leave apart, that a minute's figures share each stretch of work out by its
 * time in each minute, and of the quota that the period and the filters do not reach it, that it is
 * the whole account's whatever project is chosen, that no
 * two of its shares are added and what «Breakdown» is and leaves out. A block says
 * none of them again. A value's side panel stands over its section's «ⓘ», so its figures say the
 * spending caveats of the value's own read in an «ⓘ» of their own.
 */
import { useI18n } from 'vue-i18n'

import type { Usage } from '@/shared/api/analyticsApi.ts'

export function useSectionCaveats() {
  const { t } = useI18n()
  /** A period read by the minute, whose figures are shared out among the minutes. */
  const minutes = (usage: Usage) =>
    usage.period.step === 'minute' ? [t('analytics.time.estimate')] : []
  const tokens = () => t('analytics.panel.table.kinds.note')
  return {
    /**
     * The overview, a dimension and a value's figures: the agent time of agents at once added up,
     * the cost, the tokens and the minutes.
     */
    spending: (usage: Usage) => [
      t('analytics.figures.timeNote'),
      t('analytics.figures.costNote'),
      tokens(),
      ...minutes(usage),
    ],
    /** The token kinds: what the tokens count, and the minutes. */
    kinds: (usage: Usage) => [tokens(), ...minutes(usage)],
    /** A section of the quota: what does not reach it, and what used each window. */
    quota: () => [
      t('analytics.quota.panel.intro'),
      t('analytics.quota.panel.account'),
      t('analytics.quota.spent.basis'),
    ],
  }
}
