/**
 * How the Analytics page names what it shows: a dimension, and a value of one as a card or the
 * rail already names it — a task by its number and title, a project by its name, a session by
 * the title its client gave it as the live work names it, else by its client and the start of
 * its id, and an account by the name the owner gave it in Settings, as Valkama keeps it, else by
 * the start of its id as an item's card does. What a name leaves out is its `valueDetail`, which
 * the page says in the hint or beside the name: a titled session's client and the start of its
 * id, so two of one title can be told apart; an account's whole id is never a hint. Work with no
 * value — no task, a session's own run — and a value nobody can place say so in words of their
 * own, per dimension: «unknown» is said only of what nobody can place.
 *
 * A task's name holds its title, and code in a title is drawn as code wherever the page draws the
 * name (`titleRuns`): beside each name that holds one, its runs (`valueRuns`, `pairRuns`,
 * `lineRuns`), which a chart, its table, its hints, a filter's choice and chip, a tile and the side
 * panel draw it in. Written, they are the name, backticks included, which is what every place
 * that holds it as text keeps: an accessible name, a hint's text, a download, a sort, a search.
 */
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'

import type { PerHour } from '@/pages/analytics/utils/panelAnswer.ts'
import type { OverviewFigures } from '@/pages/analytics/utils/railFigures.ts'
import { dayOf, named, withinToday } from '@/pages/analytics/utils/readMoments.ts'
import { figureOf, measureOf } from '@/pages/analytics/utils/usageFigures.ts'
import type { LineChange, SpendingLine, Spent } from '@/pages/analytics/utils/usageFigures.ts'
import { isSeveral, valueKind } from '@/pages/analytics/utils/usageValues.ts'

import { agentIdStart } from '@/widgets/work-item-inspector/utils/agentFacts.ts'
import { useUsageWords } from '@/widgets/work-item-inspector/utils/useUsageWords.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { UsageDimension, UsageGroupValue, UsageStep } from '@/shared/api/analyticsApi.ts'
import type { UsageTokens } from '@/shared/api/planningUsageApi.ts'
import { aliasOf } from '@/shared/lib/accountAliases.ts'
import { accountLabel } from '@/shared/lib/accountLabel.ts'
import type { AnsweredNames } from '@/shared/lib/accountLabel.ts'
import { spanWordsOf } from '@/shared/lib/timeSpan.ts'
import { referencedTitleRuns } from '@/shared/lib/titleRuns.ts'
import { tokensAnew } from '@/shared/lib/tokensAnew.ts'
import { useAccountNamesStore } from '@/shared/stores/accountNamesStore.ts'
import { REMARK_JOINT } from '@/shared/ui/chartGeometry.ts'
import { durationAxis } from '@/shared/ui/durationAxis.ts'
import type { TrendPoint } from '@/shared/ui/MiniTrend.vue'
import type { TextRun } from '@/shared/ui/textRuns.ts'

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

/**
 * The dimensions whose value a read names, from what it says beside the id: a task by its code and
 * title, a project by its name, a session by its title. Any other is named from its id alone.
 */
const NAMED_BY_READ: ReadonlySet<UsageDimension> = new Set(['work_item', 'project', 'executor'])

/** The space no line breaks at. */
const NO_BREAK = '\u{A0}'

/** A share is said in whole percents: what rounds away at either end is said as more or less. */
const SHARE_STEP = 0.01

/** A session as it is named when its client gave it no title: «claude · 1a2b3c4d». */
const sessionPlace = (value: UsageGroupValue & { id: string }) =>
  [value.family, value.id.slice(0, SESSION_PREFIX)].filter(Boolean).join(' · ')

/**
 * What a value's name leaves out, for its hint and its table: the client and the start of the id
 * of a session named by its title; nothing for any other value. An account's whole id is no
 * hint: it is the owner's to copy where the account's menu offers it, never a line to read.
 */
function valueDetail(name: UsageDimension, value: UsageGroupValue | null): string | undefined {
  const id = value?.id
  if (!value || !id) return
  if (name === 'executor') return value.title ? sessionPlace({ ...value, id }) : undefined
}

/**
 * A value's name as the runs it is drawn in, where it holds a task's title: its reference whole
 * and its title's code as code (`referencedTitleRuns`); undefined for a name that holds no title,
 * which is drawn as the text it is. Written, the runs are the value's name (`valueLabel`).
 */
function valueRuns(name: UsageDimension, value: UsageGroupValue): TextRun[] | undefined {
  if (name !== 'work_item' || valueKind(value) !== 'category' || !value.reference) return
  return value.title
    ? referencedTitleRuns(value.reference, value.title, ' ')
    : [{ kind: 'reference', text: value.reference }]
}

/**
 * A figure as a line says it, with what it leaves out apart: the tokens a cost has no price for,
 * «40 тыс. токенов без цены», empty where it leaves none out. A table lays the remark under the
 * figure; everything else says the two as one (`besides`).
 */
export interface FigureWords {
  remark: string
  text: string
}

/** A figure and its remark as one: «≈ 1 109,00 $, 40 тыс. токенов без цены». */
const besides = ({ text, remark }: FigureWords) => [text, remark].filter(Boolean).join(REMARK_JOINT)

export function useSpendingWords() {
  const i18n = useI18n()
  const { t } = i18n
  const usage = useUsageWords()
  const { names } = storeToRefs(useAccountNamesStore())

  /** The owner's name for an account or an organization, by its id, or null where it has none. */
  const accountName = (id: string) => aliasOf(names.value, id)

  /**
   * An account by its id, as the app says one (`accountLabel.ts`); `answered` is what the quota's
   * answer named it, until the names are read.
   */
  const seatLabel = (
    id: string,
    weeklyReset: string | null = null,
    answered: AnsweredNames | null = null,
  ) =>
    accountLabel(
      names.value,
      { id, weeklyReset },
      {
        locale: i18n.locale.value,
        unplaced: (organization) => t('analytics.values.seat.unplaced', { organization }),
        weekly: (organization, reset) => t('analytics.values.seat.weekly', { organization, reset }),
      },
      answered,
    )

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
   * What is said of a measure with the tokens a cost leaves out as its remark — `count` of them —
   * so a cost that misses some never reads as whole; a figure of any other measure as it is.
   */
  const leavingOut = (name: Measure, text: string, count: number): FigureWords => ({
    text,
    remark: name === 'cost' ? unpricedTokens(count) : '',
  })

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
   * which period has none — no price, no token counted — and no change at all; for accounts whose
   * figure before is not known (`LineChange`), the table's own words for it.
   */
  function change(name: Measure, moved: LineChange, before: string) {
    if (moved.direction === 'unplaced') return t('analytics.table.moved.unplaced')
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
   * compared with: the arrow and the share, which period has no figure, or, for an account, that
   * its figure before is not known (`LineChange`).
   */
  function changeCell(name: Measure, moved: LineChange) {
    if (moved.direction === 'absent')
      return t(`analytics.table.moved.absent.${name}.${moved.missing}`)
    if (moved.direction === 'none' || moved.direction === 'same' || moved.direction === 'unplaced')
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
    if (name === 'seat') {
      const said = seatLabel(value.id, value.weekly_reset ?? null)
      return value.shared ? `${said} · ${t('analytics.values.seat.shared')}` : said
    }
    return value.id
  }

  /** A value's name from its id alone, where no read is in hand; null where a read names it. */
  const idLabel = (name: UsageDimension, id: string) =>
    NAMED_BY_READ.has(name) ? null : categoryLabel(name, { id, unknown: false })

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

  /** A value or a pair as `pairLabel` names it, in runs where either holds a task's title. */
  function pairRuns(
    name: UsageDimension,
    value: UsageGroupValue,
    second?: SpendingLine['second'],
  ): TextRun[] | undefined {
    const first = valueRuns(name, value)
    const end = second && valueRuns(second.dimension, second.value)
    if (!first && !end) return
    const text = (words: string): TextRun[] => (words ? [{ kind: 'text', text: words }] : [])
    return [
      ...(first ?? text(valueLabel(name, value))),
      ...(second
        ? [...text(' · '), ...(end ?? text(valueLabel(second.dimension, second.value)))]
        : []),
    ]
  }

  /** A line of a breakdown by its name: a value or a pair, or the folded tail with how many it holds. */
  const lineLabel = (name: UsageDimension, line: SpendingLine) =>
    line.value
      ? pairLabel(name, line.value, line.second)
      : t('analytics.values.other', { count: line.folded }, line.folded)

  /** A line's name (`lineLabel`) in runs where it holds a task's title; the folded tail has none. */
  const lineRuns = (name: UsageDimension, line: SpendingLine) =>
    line.value ? pairRuns(name, line.value, line.second) : undefined

  /** The end a line's name keeps whole where it is cut: a pair's (`pairEnd`); none otherwise. */
  const lineEnd = (line: SpendingLine) => (line.value && pairEnd(line.second)) || undefined

  /**
   * A line's figure in a measure and its remark: a cost's remark is the tokens it leaves out, and
   * a line with no price at all says them as its figure, never a zero.
   */
  function lineFigureWords(name: Measure, spent: Spent): FigureWords {
    return name === 'cost' && spent.cost === null && spent.unpriced
      ? { text: unpriced(spent), remark: '' }
      : leavingOut(name, figure(name, spent), spent.unpriced)
  }

  /** A line's figure with its remark beside it (`lineFigureWords`), as one line says them. */
  const lineFigure = (name: Measure, spent: Spent) => besides(lineFigureWords(name, spent))

  /**
   * A figure with its share of a whole after it, «4 дн. 1 ч · 78 %», as a ranked row prints it
   * where its bar alone would leave the reader to guess how much of the whole it is; the figure
   * alone where there is no share to say (`null`).
   */
  const withShare = (figure: string, ratio: number | null) =>
    ratio === null ? figure : t('analytics.figures.withShare', { figure, share: share(ratio) })

  /**
   * A line's figure (`lineFigure`) with its share of what every line of its breakdown adds up to
   * (`whole`): none for a line the measure has no amount for — no price, no token counted — and
   * none of a whole of nothing.
   */
  function lineShare(name: Measure, spent: Spent, whole: number) {
    const amount = measureOf(name, spent)
    return withShare(lineFigure(name, spent), amount === null || whole <= 0 ? null : amount / whole)
  }

  /**
   * How a line's measure moved, as a table cell says it (`changeCell`), and its remark: a change
   * of a cost that compares two figures has the tokens they leave out, by the rule
   * `lineFigureWords` says them for one figure, so a change of incomplete costs never reads as
   * whole.
   */
  function lineChangeWords(
    name: Measure,
    moved: LineChange,
    now: Spent,
    before: Spent,
  ): FigureWords {
    const said = changeCell(name, moved)
    return moved.direction === 'absent' ||
      moved.direction === 'none' ||
      moved.direction === 'unplaced'
      ? { text: said, remark: '' }
      : leavingOut(name, said, now.unpriced + before.unpriced)
  }

  /** How a line's measure moved with its remark beside it (`lineChangeWords`), as one line. */
  const lineChange = (name: Measure, moved: LineChange, now: Spent, before: Spent) =>
    besides(lineChangeWords(name, moved, now, before))

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

  /**
   * What changed in the accounts that worked (`AccountChange`), each that came «+» and each that
   * left «−»: «Account change: +b» where b joined a, «Account change: +b, −a» where b took a's place.
   */
  const accounts = (came: readonly UsageGroupValue[], left: readonly UsageGroupValue[]) =>
    t('analytics.days.accounts', {
      change: [
        ...came.map((value) => `+${valueLabel('seat', value)}`),
        ...left.map((value) => `−${valueLabel('seat', value)}`),
      ].join(', '),
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
    accountName,
    seatLabel,
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
    idLabel,
    lineChange,
    lineChangeWords,
    lineFigure,
    lineFigureWords,
    lineEnd,
    lineLabel,
    lineRuns,
    lineShare,
    measure,
    noneLabel,
    pairEnd,
    pairLabel,
    pairRuns,
    tokenKinds,
    unpriced,
    valueDetail,
    valueLabel,
    valueRuns,
    withShare,
  }
}
