/**
 * How the Analytics page names what it shows: a dimension, and a value of one as a card or the
 * rail already names it — a task by its number and title, a project by its name, a session by
 * its client and the start of its id. Work with no task and a value nobody can place say so in
 * words of their own.
 */
import { useI18n } from 'vue-i18n'

import type { Measure } from '@/pages/analytics/utils/analyticsAddress.ts'
import type { Change, Spent } from '@/pages/analytics/utils/usageFigures.ts'
import { valueKind } from '@/pages/analytics/utils/usageValues.ts'

import { useUsageWords } from '@/widgets/work-item-inspector/utils/useUsageWords.ts'

import type { UsageDimension, UsageGroupValue } from '@/shared/api/analyticsApi.ts'

/** How much of a session's id names it beside its client: enough to tell two apart. */
const SESSION_PREFIX = 8

export function useSpendingWords() {
  const i18n = useI18n()
  const { t } = i18n
  const usage = useUsageWords()

  const compact = (value: number) =>
    new Intl.NumberFormat(i18n.locale.value, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value)
  const percent = (ratio: number) =>
    new Intl.NumberFormat(i18n.locale.value, { style: 'percent', maximumFractionDigits: 0 }).format(
      Math.abs(ratio),
    )

  const measure = (name: Measure) => t(`analytics.measures.${name}`)

  /** A measure's figure as a line reads it; no data in words, never a zero. */
  function figure(name: Measure, spent: Spent) {
    if (name === 'time') return usage.time(spent.seconds) || t('analytics.figures.noTime')
    if (name === 'tokens')
      return spent.tokens ? compact(spent.tokens) : t('analytics.figures.noTokens')
    return usage.cost(spent.cost) || t('analytics.figures.noPrice')
  }

  /** The tokens a cost leaves out, said in words; nothing when it leaves none out. */
  const unpriced = (spent: Spent) =>
    spent.unpriced
      ? t(
          'analytics.figures.unpriced',
          { count: compact(spent.unpriced) },
          Math.min(spent.unpriced, 1000),
        )
      : ''

  /** A period by its first and last day: «2 – 8 Nov». */
  function days(from: string, to: string) {
    const end = new Date(Date.parse(to) - 1)
    return new Intl.DateTimeFormat(i18n.locale.value, {
      day: 'numeric',
      month: 'short',
    }).formatRange(new Date(from), end)
  }

  /** How a figure moved, against the period it is compared with. */
  function change(moved: Change, before: string) {
    if (moved.direction === 'none') return t('analytics.change.none', { period: before })
    if (moved.direction === 'same') return t('analytics.change.same', { period: before })
    return t(`analytics.change.${moved.direction}`, {
      change: percent(moved.ratio),
      period: before,
    })
  }

  const dimension = (name: UsageDimension) => t(`analytics.dimensions.${name}`)

  /** What a filter's «none» admits: work on no task, or a value the store does not hold. */
  const noneLabel = (name: UsageDimension) =>
    name === 'work_item' ? t('analytics.values.none') : t('analytics.values.unknown')

  function categoryLabel(name: UsageDimension, value: UsageGroupValue & { id: string }) {
    if (name === 'work_item')
      return value.reference
        ? [value.reference, value.title].filter(Boolean).join(' ')
        : t('analytics.values.deleted')
    if (name === 'project') return value.name ?? value.id
    if (name === 'executor')
      return [value.family, value.id.slice(0, SESSION_PREFIX)].filter(Boolean).join(' · ')
    if (name === 'role' && i18n.te(`analytics.roles.${value.id}`))
      return t(`analytics.roles.${value.id}`)
    return value.id
  }

  function valueLabel(name: UsageDimension, value: UsageGroupValue) {
    const kind = valueKind(value)
    if (kind === 'none') return t('analytics.values.none')
    if (kind === 'unknown') return t('analytics.values.unknown')
    return categoryLabel(name, value as UsageGroupValue & { id: string })
  }

  return { change, days, dimension, figure, measure, noneLabel, unpriced, valueLabel }
}
