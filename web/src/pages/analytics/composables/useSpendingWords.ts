/**
 * How the Analytics page names what it shows: a dimension, and a value of one as a card or the
 * rail already names it — a task by its number and title, a project by its name, a session by
 * the title its client gave it as the live work names it, else by its client and the start of
 * its id, and an account by the name the owner gave it in Settings, as Valkama keeps it, else by
 * the start of its id as an item's card does. What a name leaves out is its `valueDetail`, which
 * the page says in the hint or beside the name: a titled session's client and the start of its
 * id, so two of one title can be told apart, and an account's whole id. Work with no value — no task, a session's own
 * run — and a value nobody can place say so in words of their own, per dimension: «unknown» is
 * said only of what nobody can place.
 */
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'

import type { PerHour } from '@/pages/analytics/utils/panelAnswer.ts'
import type { OverviewFigures } from '@/pages/analytics/utils/railFigures.ts'
import { dayOf, named, withinToday } from '@/pages/analytics/utils/readMoments.ts'
import { figureOf } from '@/pages/analytics/utils/usageFigures.ts'
import type { Change, SpendingLine, Spent } from '@/pages/analytics/utils/usageFigures.ts'
import { isSeveral, valueKind } from '@/pages/analytics/utils/usageValues.ts'

import { agentIdStart } from '@/widgets/work-item-inspector/utils/agentFacts.ts'
import { tokensAnew, useUsageWords } from '@/widgets/work-item-inspector/utils/useUsageWords.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { UsageDimension, UsageGroupValue, UsageStep } from '@/shared/api/analyticsApi.ts'
import type { UsageTokens } from '@/shared/api/planningUsageApi.ts'
import { aliasOf } from '@/shared/lib/accountAliases.ts'
import { spanWordsOf } from '@/shared/lib/timeSpan.ts'
import { useAccountNamesStore } from '@/shared/stores/accountNamesStore.ts'
import { durationAxis } from '@/shared/ui/durationAxis.ts'
import type { TrendPoint } from '@/shared/ui/MiniTrend.vue'

/** How much of a session's id names it beside its client: enough to tell two apart. */
const SESSION_PREFIX = 8

/** A period shorter than this is named by its clock times, a longer one by its days. */
const DAY = 24 * 3_600_000

/** A date as a period names its days, «8 Nov». */
const DATE: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }

/** A time of the clock, «09:05», «21:25»: the clock the minutes of a chart read on. */
const CLOCK: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }

/** A time of the clock on a day not today, with its date: «Nov 10, 09:05», «10 нояб., 09:05». */
const DATED_CLOCK: Intl.DateTimeFormatOptions = { ...DATE, ...CLOCK }

/** The charts count time in hours (`scale`). */
const HOUR_SECONDS = 3600

/**
 * The dimensions where work with no value is a value of its own (`id` null, not unknown): work
 * on no task, a session's own run, which no one launched, and work on a task naming no project.
 * Elsewhere the read has no such value, and a filter's «none» admits an unknown one instead.
 */
const NO_VALUE: ReadonlySet<UsageDimension> = new Set(['work_item', 'launch_class', 'project'])

/** The space no line breaks at. */
const NO_BREAK = '\u{A0}'

/** A share is said in whole percents: what rounds away at either end is said as more or less. */
const SHARE_STEP = 0.01

/** A session as it is named when its client gave it no title: «claude · 1a2b3c4d». */
const sessionPlace = (value: UsageGroupValue & { id: string }) =>
  [value.family, value.id.slice(0, SESSION_PREFIX)].filter(Boolean).join(' · ')

export function useSpendingWords() {
  const i18n = useI18n()
  const { t } = i18n
  const usage = useUsageWords()
  const { names } = storeToRefs(useAccountNamesStore())

  /** The owner's name for an account, or null where it has none. */
  const accountName = (id: string) => aliasOf(names.value, id)

  /**
   * What a value's name leaves out, for its hint and its table: the client and the start of the id
   * of a session named by its title; the whole id of an account named by the owner's name or by the
   * start of its id; nothing where the name is the whole of what it says.
   */
  function valueDetail(name: UsageDimension, value: UsageGroupValue | null): string | undefined {
    const id = value?.id
    if (!value || !id) return
    if (name === 'executor') return value.title ? sessionPlace({ ...value, id }) : undefined
    if (name === 'account' && (accountName(id) !== null || agentIdStart(id) !== id)) return id
  }

  const compact = (value: number) =>
    new Intl.NumberFormat(i18n.locale.value, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value)
  const percent = (ratio: number) =>
    new Intl.NumberFormat(i18n.locale.value, { style: 'percent', maximumFractionDigits: 0 }).format(
      Math.abs(ratio),
    )

  /**
   * A share of a whole in whole percents, never claiming more or less than it holds: «100 %»
   * only for all of it and «0 %» only for none, so a share a hair under the whole reads «>99 %»
   * and one a hair over nothing «<1 %».
   */
  function share(ratio: number) {
    if (ratio > 0 && ratio < SHARE_STEP / 2) return `<${percent(SHARE_STEP)}`
    if (ratio < 1 && ratio >= 1 - SHARE_STEP / 2) return `>${percent(1 - SHARE_STEP)}`
    return percent(ratio)
  }

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
   * day, by its clock times, «20:26 – 21:25», the end being the last minute it holds. Clock times
   * alone read as today's, so a short period not wholly within today names its day before them:
   * the same hours of yesterday «Today» is compared with are «Nov 10, 00:00 – 15:59». A line
   * breaks only after the dash: never inside a date, and never with the dash starting a line.
   */
  function period(from: string, to: string) {
    let options = DATE
    if (Date.parse(to) - Date.parse(from) < DAY)
      options = withinToday(from, to) ? CLOCK : DATED_CLOCK
    return dayFormat(options)
      .formatRange(named(from), named(to, -1))
      .replaceAll(/\s/gu, NO_BREAK)
      .replace(`–${NO_BREAK}`, '– ')
  }

  /**
   * The reader's own period between two local moments as the bar names it, `2030-03-04T10:00`
   * each: by its date and clock times, «13 нояб., 10:00–13:00», «Nov 12, 22:00 – Nov 13, 01:00»,
   * the end being the moment it ends at. The date stands even for today's hours, since nothing
   * beside the bar's period says which day they are of.
   */
  const span = (from: string, to: string) =>
    dayFormat(DATED_CLOCK).formatRange(new Date(`${from}Z`), new Date(`${to}Z`))

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
    if (name === 'executor') return value.title ?? sessionPlace(value)
    if (name === 'role' && i18n.te(`analytics.roles.${value.id}`))
      return t(`analytics.roles.${value.id}`)
    if (name === 'account') return accountName(value.id) ?? agentIdStart(value.id)
    return value.id
  }

  function valueLabel(name: UsageDimension, value: UsageGroupValue) {
    const kind = valueKind(value)
    if (kind === 'none' && isSeveral(value)) return t('analytics.values.several')
    if (kind === 'none') return noValue(name)
    if (kind === 'unknown') return t('analytics.values.unknown')
    return categoryLabel(name, value as UsageGroupValue & { id: string })
  }

  /**
   * What a pair's name says after the section's value, « · high»: the end that tells the pairs of
   * one value apart, so it stays whole where the name is cut (`PairName`). Empty for one value.
   */
  const pairEnd = (second?: SpendingLine['second']) =>
    second ? ` · ${valueLabel(second.dimension, second.value)}` : ''

  /**
   * A value by its name, or a pair by both, the section's value first: «claude-opus-5-5 · high».
   */
  const pairLabel = (
    name: UsageDimension,
    value: UsageGroupValue,
    second?: SpendingLine['second'],
  ) => `${valueLabel(name, value)}${pairEnd(second)}`

  /** A line of a breakdown by its name: a value or a pair, or the folded tail with how many it holds. */
  const lineLabel = (name: UsageDimension, line: SpendingLine) =>
    line.value
      ? pairLabel(name, line.value, line.second)
      : t('analytics.values.other', { count: line.folded }, line.folded)

  /** The end a line's name keeps whole where it is cut: a pair's (`pairEnd`); none otherwise. */
  const lineEnd = (line: SpendingLine) => (line.value && pairEnd(line.second)) || undefined

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

  /**
   * What a breakdown is by: «by task», or by its pairs with a second dimension, «by model and by
   * effort».
   */
  const breakdownBy = (by: UsageDimension, across?: UsageDimension | null) =>
    across
      ? t('analytics.panel.split.by', {
          by: t(`analytics.byDimension.${by}`),
          across: t(`analytics.byDimension.${across}`),
        })
      : t(`analytics.byDimension.${by}`)

  /** What a breakdown's values are called, «Model», or its pairs, «Model · Effort». */
  const breakdownName = (by: UsageDimension, across?: UsageDimension | null) =>
    across ? `${dimension(by)} · ${dimension(across)}` : dimension(by)

  /**
   * What a chart of a measure by a dimension is called, «Agent time by task», and by its pairs
   * with a second one, «Agent time by model and by effort».
   */
  const chartTitle = (name: Measure, by: UsageDimension, across?: UsageDimension | null) =>
    t('analytics.chart', { measure: measure(name), by: breakdownBy(by, across) })

  /** A day as the time axis names it, «Mon 9», and in full for the hints and the table. */
  const day = (start: string) =>
    dayFormat({ weekday: 'short', day: 'numeric' }).format(named(start))
  const longDay = (start: string) =>
    dayFormat({ weekday: 'long', day: 'numeric', month: 'long' }).format(named(start))

  /**
   * A day as a sentence names it after «of» or «за»: by its date first where a weekday would
   * have to be declined, «11 ноября, ср», and in full where it need not, «Wednesday, November 11».
   */
  const fullDay = (start: string) =>
    t('analytics.drill.dayName', {
      date: dayFormat({ day: 'numeric', month: 'long' }).format(named(start)),
      weekday: dayFormat({ weekday: 'short' }).format(named(start)),
      weekdayLong: dayFormat({ weekday: 'long' }).format(named(start)),
    })

  /** An hour or a minute as the time axis names it, «14:05», and in full with its day. */
  const clock = (start: string) => dayFormat(CLOCK).format(named(start))
  const fullClock = (start: string) =>
    dayFormat({ weekday: 'long', day: 'numeric', month: 'long', ...CLOCK }).format(named(start))
  /**
   * A moment of another day as short as a period's hours of that day are named (`period`), its
   * date and its clock time, «Nov 10, 14:05»: the clock time alone would read as today's.
   */
  const datedClock = (start: string) => dayFormat(DATED_CLOCK).format(named(start))

  /**
   * A step of a period by its start, short and in full: a day by its weekday and date, else its
   * time. A day carries too its date with the month, «Oct 27», and which month that is, which a
   * time axis prints where a month starts (`PeriodColumn.dated`); a time needs no month.
   */
  const stepName = (start: string, step: UsageStep) =>
    step === 'day'
      ? {
          label: day(start),
          fullLabel: longDay(start),
          dated: {
            label: dayFormat({ day: 'numeric', month: 'short' }).format(named(start)),
            month: dayOf(start).slice(0, 7),
          },
        }
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

  /** What changed in the accounts that worked: «Account change: a → a, b». */
  const accounts = (before: readonly UsageGroupValue[], after: readonly UsageGroupValue[]) =>
    t('analytics.days.accounts', {
      before: before.map((value) => valueLabel('account', value)).join(', '),
      after: after.map((value) => valueLabel('account', value)).join(', '),
    })

  /**
   * The chart of a period step by step: «Agent time per minute, by task», or by its pairs with a
   * second dimension, «Agent time per day, by model and by effort».
   */
  const stepChartTitle = (
    name: Measure,
    by: UsageDimension,
    step: UsageStep,
    across?: UsageDimension | null,
  ) =>
    t('analytics.days.title', {
      measure: measure(name),
      per: per(step),
      by: breakdownBy(by, across),
    })

  /**
   * A figure per hour of agent time beside the period before's, in the page's compact numbers
   * with the unit said once: «$17.9/h, was 8.1», «1.2M/h, was 800K»; no «was» where the period
   * before has none. `detail` says what the line is of, the cost's as the estimate it is.
   */
  function perHour(name: 'cost' | 'tokens', rate: PerHour) {
    const now = compact(rate.now)
    const line =
      rate.was === null
        ? t(`analytics.figures.perHour.${name}`, { now })
        : t(`analytics.figures.perHour.${name}Was`, { now, was: compact(rate.was) })
    return { line, detail: t(`analytics.figures.perHour.${name}Detail`) }
  }

  /** A step's figure in the measure's units, or the words for a step with none. */
  function amount(name: Measure, value: number | null) {
    if (value === null) return t(`analytics.days.absent.${name}`)
    return value === 0 && name === 'time' ? t('time.minutes', { count: 0 }) : scale(name, value)
  }

  /**
   * A period's steps in words — days, hours, or the minutes of the live hour: the first and the
   * last, the highest, and the last one's figure; the total alone where no step has one.
   */
  function trendWords(name: Measure, figures: OverviewFigures, step: UsageStep) {
    const steps = figures.trend
    const label = (key: string) => stepName(key, step).label
    let top = steps.at(0)
    for (const one of steps) if ((one.value ?? 0) > (top?.value ?? 0)) top = one
    const first = steps.at(0)
    const last = steps.at(-1)
    if (!first || !last || !top?.value)
      return t('analytics.figures.trendNone', {
        measure: measure(name),
        per: per(step),
        figure: figure(name, figures.total),
      })
    return t('analytics.figures.trend', {
      measure: measure(name),
      per: per(step),
      from: label(first.key),
      to: label(last.key),
      top: amount(name, top.value),
      day: label(top.key),
      last: [amount(name, last.value), last.incomplete ? t('analytics.days.soFar') : '']
        .filter(Boolean)
        .join(' '),
    })
  }

  /**
   * A period's steps as a small trend (`MiniTrend`) with its words: the rail's tile of the
   * overview and each of the page's figures draw and say it the same way.
   */
  const trend = (
    name: Measure,
    figures: OverviewFigures,
    step: UsageStep,
  ): { label: string; points: TrendPoint[] } => ({
    label: trendWords(name, figures, step),
    points: figures.trend,
  })

  /** A mark's share of the whole its chart draws, as its hint says it: «42 % of the total». */
  const markShare = (ratio: number) => t('analytics.marks.share', { share: share(ratio) })

  return {
    accounts,
    axis,
    breakdownBy,
    breakdownName,
    change,
    chartTitle,
    datedClock,
    day,
    fullDay,
    markShare,
    scale,
    share,
    span,
    period,
    per,
    perHour,
    stepChartTitle,
    stepName,
    trend,
    dimension,
    figure,
    lineChange,
    lineFigure,
    lineEnd,
    lineLabel,
    measure,
    noneLabel,
    pairEnd,
    pairLabel,
    tokenKinds,
    unpriced,
    valueDetail,
    valueLabel,
  }
}
