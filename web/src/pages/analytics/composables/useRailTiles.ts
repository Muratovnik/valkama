/**
 * What each tile of the rail says beside its section's name, in the page's chosen measure.
 *
 * The overview's tile reads the page's own answer, the one its panel shows, so it adds no read:
 * the period's total, how it moved from the period before, and its days as a small trend. A
 * dimension's tile reads its own breakdown (`useRailReads`): how many values worked, the first of
 * them with its share, and the shares of the first few as a small bar.
 *
 * A tile always says something in the same place. Before its first answer it says it is reading;
 * a read that failed says so; a period that spent nothing says there is no data, never a zero.
 * A new answer replaces the words where they stand, and the last ones stay while it is read.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useRailReads } from '@/pages/analytics/composables/useRailReads.ts'
import type { RailRead } from '@/pages/analytics/composables/useRailReads.ts'
import type { SharedUsage } from '@/pages/analytics/composables/useSharedUsage.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { rankedSlots } from '@/pages/analytics/utils/dayFigures.ts'
import { dimensionFigures, overviewFigures } from '@/pages/analytics/utils/railFigures.ts'
import type { OverviewFigures } from '@/pages/analytics/utils/railFigures.ts'
import { spentAnything, spentOf } from '@/pages/analytics/utils/usageFigures.ts'

import { OVERVIEW } from '@/shared/api/analyticsAddress.ts'
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
  const rail = useRailReads(options)

  const percent = (share: number) =>
    new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 0 }).format(
      share,
    )

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
    }))
    const said = figures.parts.map(
      (part) =>
        `${part.line ? words.lineLabel(dimension, part.line) : t('analytics.rail.rest')} ${percent(part.share)}`,
    )
    return {
      ...standing('ready', words.lineLabel(dimension, first.line)),
      leadDetail: first.line.value ? words.valueDetail(dimension, first.line.value) : undefined,
      quiet: first.line.kind !== 'category',
      aside: first.share === null ? words.figure(measure, first.line.spent) : percent(first.share),
      count: t('analytics.rail.values', { count: figures.count }, figures.count),
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

  const tiles = computed(() => {
    const { measure } = options.view()
    const reads = rail.reads.value
    const all: Partial<Record<AnalyticsSection, RailTileModel>> = {
      [OVERVIEW]: overviewTile(measure),
    }
    for (const dimension of options.dimensions())
      all[dimension] = dimensionTile(dimension, reads[dimension], measure)
    return all
  })

  return { refresh: rail.refresh, tiles }
}
