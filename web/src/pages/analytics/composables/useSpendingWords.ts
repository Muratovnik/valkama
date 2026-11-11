/**
 * How the Analytics page names what it shows: a dimension, and a value of one as a card or the
 * rail already names it — a task by its number and title, a project by its name, a session by
 * its client and the start of its id. Work with no value — no task, a session's own run — and a
 * value nobody can place say so in words of their own, per dimension: «unknown» is said only of
 * what nobody can place.
 */
import { useI18n } from 'vue-i18n'

import type { Change, SpendingLine, Spent } from '@/pages/analytics/utils/usageFigures.ts'
import { valueKind } from '@/pages/analytics/utils/usageValues.ts'

import { useUsageWords } from '@/widgets/work-item-inspector/utils/useUsageWords.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { UsageDimension, UsageGroupValue } from '@/shared/api/analyticsApi.ts'

/** How much of a session's id names it beside its client: enough to tell two apart. */
const SESSION_PREFIX = 8

/**
 * The dimensions where work with no value is a value of its own (`id` null, not unknown): work
 * on no task, and a session's own run, which no one launched. Elsewhere the read has no such
 * value, and a filter's «none» admits an unknown one instead.
 */
const NO_VALUE: ReadonlySet<UsageDimension> = new Set(['work_item', 'launch_class'])

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

  /**
   * How a measure's figure moved, against the period it is compared with; with a figure absent,
   * which period has none — no price, no token counted — and no change at all.
   */
  function change(name: Measure, moved: Change, before: string) {
    if (moved.direction === 'absent')
      return t(`analytics.change.absent.${name}.${moved.missing}`, { period: before })
    if (moved.direction === 'none') return t('analytics.change.none', { period: before })
    if (moved.direction === 'same') return t('analytics.change.same', { period: before })
    return t(`analytics.change.${moved.direction}`, {
      change: percent(moved.ratio),
      period: before,
    })
  }

  const dimension = (name: UsageDimension) => t(`analytics.dimensions.${name}`)

  /** Work with no value in a dimension, where it has one of its own: no task, the session itself. */
  const noValue = (name: UsageDimension) =>
    t(`analytics.values.none.${NO_VALUE.has(name) ? name : 'other'}`)

  /**
   * What a filter's «none» admits, as the read takes it: work on no task, a session's own run, an
   * unknown value for the rest. Null where it admits nothing — every stretch has a role — so the
   * filter offers no such choice.
   */
  function noneLabel(name: UsageDimension) {
    if (name === 'role') return null
    return NO_VALUE.has(name) ? noValue(name) : t('analytics.values.unknown')
  }

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
    if (kind === 'none') return noValue(name)
    if (kind === 'unknown') return t('analytics.values.unknown')
    return categoryLabel(name, value as UsageGroupValue & { id: string })
  }

  /** A line of a breakdown by its name: a value, or the folded tail with how many it holds. */
  const lineLabel = (name: UsageDimension, line: SpendingLine) =>
    line.value
      ? valueLabel(name, line.value)
      : t('analytics.values.other', { count: line.folded }, line.folded)

  /**
   * A line's figure in a measure; a cost says beside it the tokens it leaves out, so a line
   * with no price reads as that and never as a zero.
   */
  function lineFigure(name: Measure, spent: Spent) {
    const left = name === 'cost' ? unpriced(spent) : ''
    return left && spent.cost === null
      ? left
      : [figure(name, spent), left].filter(Boolean).join(', ')
  }

  /** What a chart of a measure by a dimension is called: «Agent time by task». */
  const chartTitle = (name: Measure, by: UsageDimension) =>
    t('analytics.chart', { measure: measure(name), by: t(`analytics.byDimension.${by}`) })

  const dayFormat = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(i18n.locale.value, options)

  /** A day as the time axis names it, «Mon 9», and in full for the readout and the table. */
  const day = (start: string) =>
    dayFormat({ weekday: 'short', day: 'numeric' }).format(new Date(start))
  const fullDay = (start: string) =>
    dayFormat({ weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(start))

  /** A step of the value axis in the measure's units: hours as a span, tokens, dollars. */
  function scale(name: Measure, amount: number) {
    if (amount <= 0) return '0'
    if (name === 'time') return usage.time(amount * 3600)
    if (name === 'tokens') return compact(amount)
    return new Intl.NumberFormat(i18n.locale.value, { style: 'currency', currency: 'USD' }).format(
      amount,
    )
  }

  /** What changed in the accounts that worked: «Accounts: a → a, b». */
  const accounts = (before: readonly UsageGroupValue[], after: readonly UsageGroupValue[]) =>
    t('analytics.days.accounts', {
      before: before.map((value) => valueLabel('account', value)).join(', '),
      after: after.map((value) => valueLabel('account', value)).join(', '),
    })

  const dayChartTitle = (name: Measure, by: UsageDimension) =>
    t('analytics.days.title', { measure: measure(name), by: t(`analytics.byDimension.${by}`) })

  return {
    accounts,
    change,
    chartTitle,
    day,
    dayChartTitle,
    fullDay,
    scale,
    days,
    dimension,
    figure,
    lineFigure,
    lineLabel,
    measure,
    noneLabel,
    unpriced,
    valueLabel,
  }
}
