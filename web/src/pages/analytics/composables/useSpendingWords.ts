/**
 * How the Analytics page names what it shows: a dimension, and a value of one as a card or the
 * rail already names it — a task by its number and title, a project by its name, a session by
 * its client and the start of its id, an account by the start of its id as an item's card does
 * (`valueDetail` is the whole id). Work with no value — no task, a session's own run — and a
 * value nobody can place say so in words of their own, per dimension: «unknown» is said only of
 * what nobody can place.
 */
import { useI18n } from 'vue-i18n'

import { named } from '@/pages/analytics/utils/readMoments.ts'
import { figureOf } from '@/pages/analytics/utils/usageFigures.ts'
import type { Change, SpendingLine, Spent } from '@/pages/analytics/utils/usageFigures.ts'
import { valueKind } from '@/pages/analytics/utils/usageValues.ts'

import { agentIdStart } from '@/widgets/work-item-inspector/utils/agentFacts.ts'
import { tokensAnew, useUsageWords } from '@/widgets/work-item-inspector/utils/useUsageWords.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { UsageDimension, UsageGroupValue, UsageStep } from '@/shared/api/analyticsApi.ts'
import type { UsageTokens } from '@/shared/api/planningUsageApi.ts'
import { spanWordsOf } from '@/shared/lib/timeSpan.ts'
import { durationAxis } from '@/shared/ui/durationAxis.ts'

/** How much of a session's id names it beside its client: enough to tell two apart. */
const SESSION_PREFIX = 8

/** A period shorter than this is named by its clock times, a longer one by its days. */
const DAY = 24 * 3_600_000

/** A time of the clock, «09:05», «21:25»: the clock the minutes of a chart read on. */
const CLOCK: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }

/** The charts count time in hours (`scale`). */
const HOUR_SECONDS = 3600

/**
 * The dimensions where work with no value is a value of its own (`id` null, not unknown): work
 * on no task, and a session's own run, which no one launched. Elsewhere the read has no such
 * value, and a filter's «none» admits an unknown one instead.
 */
const NO_VALUE: ReadonlySet<UsageDimension> = new Set(['work_item', 'launch_class'])

/**
 * What a value's name leaves out, for its hint and its table: the whole id of an account, which
 * the page names by the start of it; nothing where the name is the whole of what it says.
 */
function valueDetail(name: UsageDimension, value: UsageGroupValue | null) {
  const id = value?.id
  return name === 'account' && id && agentIdStart(id) !== id ? id : undefined
}

/** The space no line breaks at. */
const NO_BREAK = '\u{A0}'

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

  /** Dates as `named` holds them: the date a moment names, read in UTC. */
  const dayFormat = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(i18n.locale.value, { ...options, timeZone: 'UTC' })

  /**
   * A span of agent time, one wording wherever the page says one: exactly nothing «0 min», more
   * than nothing and under a minute «under a minute», more in its two largest units. Seconds
   * come from hours on a chart's scale, so they are taken to the millisecond first: a minute
   * read back from its hours is a minute, not a hair under one.
   */
  function duration(seconds: number) {
    const held = Math.round(seconds * 1000) / 1000
    return held > 0 ? usage.time(held) : t('time.minutes', { count: 0 })
  }

  /**
   * A measure's figure as a line reads it (`figureOf`): a zero in its unit for one that spent
   * nothing there, and words for one the read does not hold — no price, no tokens counted —
   * never a zero.
   */
  function figure(name: Measure, spent: Spent) {
    const amount = figureOf(name, spent)
    if (amount === null)
      return t(name === 'tokens' ? 'analytics.figures.noTokens' : 'analytics.figures.noPrice')
    if (name === 'time') return duration(spent.seconds)
    return name === 'tokens' ? compact(amount) : usage.cost(amount)
  }

  /** So many tokens with no price, said in words; nothing for none. */
  const unpricedTokens = (count: number) =>
    count ? t('analytics.figures.unpriced', { count: compact(count) }, Math.min(count, 1000)) : ''

  /** The tokens a cost leaves out, said in words; nothing when it leaves none out. */
  const unpriced = (spent: Spent) => unpricedTokens(spent.unpriced)

  /**
   * What is said of a measure with the tokens a cost leaves out beside it — `count` of them —
   * so a cost that misses some never reads as whole; a figure of any other measure as it is.
   */
  const leavingOut = (name: Measure, said: string, count: number) =>
    [said, name === 'cost' ? unpricedTokens(count) : ''].filter(Boolean).join(', ')

  /**
   * What the tokens figure counts, by kind — input, output, cache writes, what was processed
   * anew — and the cache reads it leaves apart; nothing when no request reported a token.
   */
  function tokenKinds(split: UsageTokens): string[] {
    if (tokensAnew(split) === null) return []
    const writes = [split.cache_write_5m, split.cache_write_1h].filter((count) => count !== null)
    const kinds = {
      input: split.input,
      output: split.output,
      cacheWrites: writes.length ? writes.reduce((sum, count) => sum + count, 0) : null,
    }
    const counted = Object.entries(kinds).flatMap(([kind, count]) =>
      count === null ? [] : [t(`analytics.figures.kinds.${kind}`, { count: compact(count) })],
    )
    const apart = split.cached_read
      ? [t('analytics.figures.cacheReads', { count: compact(split.cached_read) })]
      : []
    return [t('analytics.figures.anew', { kinds: counted.join(', ') }), ...apart]
  }

  /**
   * A period as its moments name it: by its first and last day, «2 – 8 Nov», or, shorter than a
   * day, by its clock times, «20:26 – 21:25», the end being the last minute it holds. A line
   * breaks only after the dash: never inside a date, and never with the dash starting a line.
   */
  function period(from: string, to: string) {
    const short = Date.parse(to) - Date.parse(from) < DAY
    const options: Intl.DateTimeFormatOptions = short ? CLOCK : { day: 'numeric', month: 'short' }
    return dayFormat(options)
      .formatRange(named(from), named(to, -1))
      .replaceAll(/\s/gu, NO_BREAK)
      .replace(`–${NO_BREAK}`, '– ')
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

  /**
   * How a measure moved, as a table says it under a heading that names the period it is
   * compared with: the arrow and the share, or which period has no figure.
   */
  function changeCell(name: Measure, moved: Change) {
    if (moved.direction === 'absent')
      return t(`analytics.table.moved.absent.${name}.${moved.missing}`)
    if (moved.direction === 'none' || moved.direction === 'same')
      return t(`analytics.table.moved.${moved.direction}`)
    return t(`analytics.table.moved.${moved.direction}`, { change: percent(moved.ratio) })
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
    if (name === 'account') return agentIdStart(value.id)
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
    return name === 'cost' && spent.cost === null && spent.unpriced
      ? unpriced(spent)
      : leavingOut(name, figure(name, spent), spent.unpriced)
  }

  /**
   * How a line's measure moved, as a table cell says it (`changeCell`); a change of a cost that
   * compares two figures says beside it the tokens they leave out, by the rule `lineFigure`
   * says them for one figure, so a change of incomplete costs never reads as whole.
   */
  function lineChange(name: Measure, moved: Change, now: Spent, before: Spent) {
    const said = changeCell(name, moved)
    return moved.direction === 'absent' || moved.direction === 'none'
      ? said
      : leavingOut(name, said, now.unpriced + before.unpriced)
  }

  /** What a chart of a measure by a dimension is called: «Agent time by task». */
  const chartTitle = (name: Measure, by: UsageDimension) =>
    t('analytics.chart', { measure: measure(name), by: t(`analytics.byDimension.${by}`) })

  /** A day as the time axis names it, «Mon 9», and in full for the readout and the table. */
  const day = (start: string) =>
    dayFormat({ weekday: 'short', day: 'numeric' }).format(named(start))
  const fullDay = (start: string) =>
    dayFormat({ weekday: 'long', day: 'numeric', month: 'long' }).format(named(start))

  /** An hour or a minute as the time axis names it, «14:05», and in full with its day. */
  const clock = (start: string) => dayFormat(CLOCK).format(named(start))
  const fullClock = (start: string) =>
    dayFormat({ weekday: 'long', day: 'numeric', month: 'long', ...CLOCK }).format(named(start))

  /** A step of a period by its start, short and in full: a day by its date, else its time. */
  const stepName = (start: string, step: UsageStep) =>
    step === 'day'
      ? { label: day(start), fullLabel: fullDay(start) }
      : { label: clock(start), fullLabel: fullClock(start) }

  /** How a chart is cut by its steps: «per day», «per minute». */
  const per = (step: UsageStep) => t(`analytics.time.steps.${step}.per`)

  /** A step of the value axis in the measure's units: hours as a span, tokens, dollars. */
  function scale(name: Measure, amount: number) {
    if (name === 'time') return duration(amount * HOUR_SECONDS)
    if (amount <= 0) return '0'
    if (name === 'tokens') return compact(amount)
    return new Intl.NumberFormat(i18n.locale.value, { style: 'currency', currency: 'USD' }).format(
      amount,
    )
  }

  /**
   * The value axis of a measure that needs its own: time in one unit chosen by the largest
   * value, minutes, hours or days, where a figure says «3 d 23 h»; none for the others.
   */
  const axis = (name: Measure) =>
    name === 'time' ? durationAxis(spanWordsOf(t), HOUR_SECONDS) : undefined

  /** What changed in the accounts that worked: «Accounts: a → a, b». */
  const accounts = (before: readonly UsageGroupValue[], after: readonly UsageGroupValue[]) =>
    t('analytics.days.accounts', {
      before: before.map((value) => valueLabel('account', value)).join(', '),
      after: after.map((value) => valueLabel('account', value)).join(', '),
    })

  /** The chart of a period step by step: «Agent time per minute, by task». */
  const stepChartTitle = (name: Measure, by: UsageDimension, step: UsageStep) =>
    t('analytics.days.title', {
      measure: measure(name),
      per: per(step),
      by: t(`analytics.byDimension.${by}`),
    })

  return {
    accounts,
    axis,
    change,
    chartTitle,
    day,
    fullDay,
    scale,
    period,
    per,
    stepChartTitle,
    stepName,
    dimension,
    figure,
    lineChange,
    lineFigure,
    lineLabel,
    measure,
    noneLabel,
    tokenKinds,
    unpriced,
    valueDetail,
    valueLabel,
  }
}
