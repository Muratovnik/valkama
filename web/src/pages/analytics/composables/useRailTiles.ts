/**
 * What each tile of the rail says beside its section's name, in the page's chosen measure.
 *
 * The overview's tile reads the page's own answer, the one its panel shows, so it adds no read:
 * the period's total, how it moved from the period before, and its days as a small trend. A
 * dimension's tile reads its own breakdown (`useRailReads`): how many values worked, the first of
 * them with its share, and the shares of the first few as a small bar. The tile of the tokens by
 * kind reads the page's own answer too: the largest kind the tokens figure counts, its share of
 * that figure, and the counted kinds' shares, whatever the page's measure, since it is of tokens.
 *
 * A tile always says something in the same place. Before its first answer it says it is reading;
 * a read that failed says so; a period that spent nothing says there is no data, never a zero.
 * A new answer replaces the words where they stand, and the last ones stay while it is read.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useKindWords } from '@/pages/analytics/composables/useKindWords.ts'
import { useRailReads } from '@/pages/analytics/composables/useRailReads.ts'
import type { RailRead } from '@/pages/analytics/composables/useRailReads.ts'
import type { SharedUsage } from '@/pages/analytics/composables/useSharedUsage.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { rankedSlots } from '@/pages/analytics/utils/dayFigures.ts'
import { dimensionFigures, overviewFigures } from '@/pages/analytics/utils/railFigures.ts'
import type { OverviewFigures } from '@/pages/analytics/utils/railFigures.ts'
import { countedTotal, KIND_SLOTS, kindLines } from '@/pages/analytics/utils/tokenKinds.ts'
import { spentAnything, spentOf } from '@/pages/analytics/utils/usageFigures.ts'

import { OVERVIEW, TOKEN_KINDS_SECTION } from '@/shared/api/analyticsAddress.ts'
import type { AnalyticsSection, AnalyticsView, Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage, UsageDimension, UsageStep } from '@/shared/api/analyticsApi.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import type { SharePart } from '@/shared/ui/MiniShareBar.vue'
import type { TrendPoint } from '@/shared/ui/MiniTrend.vue'

export interface RailTileModel {
  /** Beside the lead: how the total moved, or the first value's share. */
  aside: string
  /** Whether the next read is asked while the words on show stay. */
  busy: boolean
  /** How many values worked, said beside the section's name; empty for the overview. */
  count: string
  /** The tile's first words: the total, the first value, or what the tile stands at. */
  lead: string
  /** Whether the lead names no real value: work with no value there, or a state. */
  quiet: boolean
  shares: { label: string; parts: SharePart[] } | null
  /** Where the tile stands: its figures, a first read, no data, or a read that failed. */
  state: 'empty' | 'failed' | 'loading' | 'ready'
  trend: { label: string; points: TrendPoint[] } | null
  /** What the lead leaves out, for its hint: an account's whole id. */
  leadDetail?: string
}

/** A tile that stands at something other than its figures: words where the figures go. */
const standing = (state: RailTileModel['state'], lead: string): RailTileModel => ({
  state,
  lead,
  quiet: true,
  aside: '',
  count: '',
  busy: false,
  trend: null,
  shares: null,
})

/** A share is said in whole percents: what rounds away at either end is said as more or less. */
const SHARE_STEP = 0.01

/**
 * A share of a whole in whole percents, never claiming more or less than it holds: «100 %» only
 * for all of it and «0 %» only for none, so a share a hair under the whole reads «>99 %» and one
 * a hair over nothing «<1 %». The page's words say shares by the same rule (`words.share`).
 */
function wholeShare(locale: string, ratio: number) {
  const percent = (part: number) =>
    new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(
      Math.abs(part),
    )
  if (ratio > 0 && ratio < SHARE_STEP / 2) return `<${percent(SHARE_STEP)}`
  if (ratio < 1 && ratio >= 1 - SHARE_STEP / 2) return `>${percent(1 - SHARE_STEP)}`
  return percent(ratio)
}

export function useRailTiles(options: {
  /** The page's shared reads, which the dimensions' reads go through. */
  shared: SharedUsage
  /** The dimensions of the rail, each a tile after the overview's. */
  dimensions: () => readonly UsageDimension[]
  /** The page's own answer, which the overview's tile reads. */
  overview: () => PlatformUiState<Usage>
  /** The moment the page's own answer was asked at. */
  overviewAt: () => Date
  projectId: () => string | null
  view: () => AnalyticsView
}) {
  const { t, locale } = useI18n()
  const words = useSpendingWords()
  const kindWords = useKindWords()
  const rail = useRailReads(options)

  // When `useSpendingWords` says shares (`words.share`), this line becomes
  // `const { share } = words` and `wholeShare` goes.
  const share = (ratio: number) => wholeShare(locale.value, ratio)

  const reading = () => standing('loading', t('analytics.rail.reading'))
  const failed = () => standing('failed', t('analytics.rail.failed'))
  const noData = () => standing('empty', t('analytics.rail.noData'))

  /** A day's figure in the measure's units, or the words for a day with none. */
  function amount(measure: Measure, value: number | null) {
    if (value === null) return t(`analytics.days.absent.${measure}`)
    return value === 0 && measure === 'time'
      ? t('time.minutes', { count: 0 })
      : words.scale(measure, value)
  }

  /**
   * The steps in words — days, or the minutes of the live hour: the first and the last, the
   * highest, and the last one's figure.
   */
  function trendLabel(measure: Measure, figures: OverviewFigures, step: UsageStep) {
    const name = (key: string) => words.stepName(key, step).label
    const days = figures.trend
    let top = days.at(0)
    for (const day of days) if ((day.value ?? 0) > (top?.value ?? 0)) top = day
    const first = days.at(0)
    const last = days.at(-1)
    if (!first || !last || !top?.value)
      return t('analytics.rail.trendNone', {
        measure: words.measure(measure),
        per: words.per(step),
        figure: words.figure(measure, figures.total),
      })
    return t('analytics.rail.trend', {
      measure: words.measure(measure),
      per: words.per(step),
      from: name(first.key),
      to: name(last.key),
      top: amount(measure, top.value),
      day: name(top.key),
      last: [amount(measure, last.value), last.incomplete ? t('analytics.days.soFar') : '']
        .filter(Boolean)
        .join(' '),
    })
  }

  /** How the total moved, as words beside it. */
  function moved(measure: Measure, figures: OverviewFigures, usage: Usage) {
    const { change } = figures
    if (!change || !usage.comparison) return t('analytics.rail.unread')
    if (change.direction === 'from')
      return t('analytics.rail.from', { before: words.figure(measure, change.before) })
    return words.lineChange(measure, change, figures.total, spentOf(usage.comparison.total))
  }

  function overviewTile(measure: Measure): RailTileModel {
    const shown = options.overview()
    if (shown.status === 'loading') return reading()
    if (!('payload' in shown)) return shown.status === 'empty' ? noData() : failed()
    const figures = overviewFigures(shown.payload, measure, options.overviewAt())
    const spent = spentAnything(figures.total)
    return {
      ...standing('ready', ''),
      lead: spent ? words.lineFigure(measure, figures.total) : t('analytics.rail.noData'),
      quiet: !spent,
      aside: moved(measure, figures, shown.payload),
      busy: shown.status === 'degraded',
      trend: {
        label: trendLabel(measure, figures, shown.payload.period.step),
        points: figures.trend,
      },
    }
  }

  function dimensionTile(dimension: UsageDimension, read: RailRead | undefined, measure: Measure) {
    if (!read || read.status === 'loading') return reading()
    if (read.status === 'failed') return failed()
    if (read.status === 'unasked') return noData()
    const figures = dimensionFigures(read.usage.rows, dimension, measure)
    if (!figures) return { ...noData(), busy: read.refreshing }
    const { first } = figures
    const slots = rankedSlots(read.usage.rows, dimension, measure)
    const parts = figures.parts.map((part) => ({
      key: part.key,
      share: part.share,
      slot: slots.get(part.key) ?? ('other' as const),
      apart: part.line?.kind === 'none',
    }))
    const said = figures.parts.map(
      (part) =>
        `${part.line ? words.lineLabel(dimension, part.line) : t('analytics.rail.rest')} ${share(part.share)}`,
    )
    return {
      ...standing('ready', words.lineLabel(dimension, first.line)),
      leadDetail: first.line.value ? words.valueDetail(dimension, first.line.value) : undefined,
      quiet: first.line.kind !== 'category',
      aside: first.share === null ? words.figure(measure, first.line.spent) : share(first.share),
      // A count of none beside work with no value, the session itself in «Now», says nothing.
      count:
        figures.count === 0 && first.line.kind === 'none'
          ? ''
          : t('analytics.rail.values', { count: figures.count }, figures.count),
      busy: read.refreshing,
      shares: {
        label: t('analytics.rail.shares', {
          measure: words.measure(measure),
          parts: said.length ? said.join(', ') : words.figure(measure, spentOf(read.usage.total)),
        }),
        parts,
      },
    }
  }

  /** The counted kinds of the page's answer: the first with its share, all with theirs. */
  function kindsTile(): RailTileModel {
    const shown = options.overview()
    if (shown.status === 'loading') return reading()
    if (!('payload' in shown)) return shown.status === 'empty' ? noData() : failed()
    const counted = kindLines(shown.payload).filter((line) => line.counted)
    const whole = countedTotal(counted) ?? 0
    const [first] = counted
    if (!first || whole <= 0) return { ...noData(), busy: shown.status === 'degraded' }
    const shareOf = (count: number | null) => (count === null ? 0 : count / whole)
    const parts = counted.map((line) => ({
      key: line.kind,
      share: shareOf(line.count),
      slot: KIND_SLOTS.get(line.kind) ?? ('other' as const),
    }))
    return {
      ...standing('ready', kindWords.name(first)),
      quiet: false,
      aside: share(shareOf(first.count)),
      count: t('analytics.kinds.count', { count: counted.length }, counted.length),
      busy: shown.status === 'degraded',
      shares: {
        label: t('analytics.rail.shares', {
          measure: words.measure('tokens'),
          parts: counted
            .map((line) => `${kindWords.name(line)} ${share(shareOf(line.count))}`)
            .join(', '),
        }),
        parts,
      },
    }
  }

  const tiles = computed(() => {
    const { measure } = options.view()
    const reads = rail.reads.value
    const all: Partial<Record<AnalyticsSection, RailTileModel>> = {
      [OVERVIEW]: overviewTile(measure),
      [TOKEN_KINDS_SECTION]: kindsTile(),
    }
    for (const dimension of options.dimensions())
      all[dimension] = dimensionTile(dimension, reads[dimension], measure)
    return all
  })

  return { refresh: rail.refresh, tiles }
}
