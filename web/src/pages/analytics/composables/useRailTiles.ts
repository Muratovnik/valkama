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
 * A tile always says something in the same place. Before its first answer it has no words of its
 * own: the wait is said by the tile (`RailTile`), once it has lasted; a read that failed says so;
 * a period that spent nothing says there is no data, never a zero.
 * A new answer replaces the words where they stand, and the last ones stay while it is read.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { ColourPlaces } from '@/pages/analytics/composables/useColourPlaces.ts'
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
import type { Usage, UsageDimension } from '@/shared/api/analyticsApi.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import type { SharePart } from '@/shared/ui/MiniShareBar.vue'
import type { TrendPoint } from '@/shared/ui/MiniTrend.vue'
import type { TextRun } from '@/shared/ui/textRuns.ts'
import type { WindowAhead } from '@/shared/ui/windowGeometry.ts'

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
  /** What the lead leaves out, for its hint: a titled session's client and the start of its id. */
  leadDetail?: string
  /** The lead in runs, where it names a task by its title (`lineRuns`): its code is code. */
  leadRuns?: readonly TextRun[]
  /** A window of the quota as a thin bar: its share spent, its pace and its forecast's tail. */
  meter?: {
    even: number | null
    forecast: WindowAhead | null
    label: string
    used: number
  } | null
}

/** A tile that stands at something other than its figures: words where the figures go. */
export const standing = (state: RailTileModel['state'], lead: string): RailTileModel => ({
  state,
  lead,
  quiet: true,
  aside: '',
  count: '',
  busy: false,
  trend: null,
  shares: null,
})

/** A first read's tile: no words of its own, the wait is said by the tile once it has lasted. */
export const reading = () => standing('loading', '')

export function useRailTiles(options: {
  /** The page's colour keys, which a tile's shares are drawn in and its reads give rows to. */
  places: ColourPlaces
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
  const { t } = useI18n()
  const words = useSpendingWords()
  const kindWords = useKindWords()
  const rail = useRailReads(options)

  // A share is said in whole percents, by the page's one rule.
  const { share } = words

  const failed = () => standing('failed', t('analytics.rail.failed'))
  const noData = () => standing('empty', t('analytics.rail.noData'))

  /**
   * How the total moved, as words beside it: the rail's own short words where the figure before
   * is not known, which the whole phrase of the table left the total no room beside.
   */
  function moved(measure: Measure, figures: OverviewFigures, usage: Usage) {
    const { change } = figures
    if (!change || !usage.comparison) return t('analytics.rail.unread')
    if (change.direction === 'unplaced') return t('analytics.rail.unplaced')
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
      trend: words.trend(measure, figures, shown.payload.period.step),
    }
  }

  function dimensionTile(dimension: UsageDimension, read: RailRead | undefined, measure: Measure) {
    if (!read || read.status === 'loading') return reading()
    if (read.status === 'failed') return failed()
    if (read.status === 'unasked') return noData()
    const figures = dimensionFigures(read.usage.rows, dimension, measure)
    if (!figures) return { ...noData(), busy: read.refreshing }
    const { first } = figures
    const places = options.places.rows(dimension) ?? read.usage.rows
    const slots = rankedSlots(places, dimension, measure)
    const parts = figures.parts.map((part) => ({
      key: part.key,
      share: part.share,
      slot: slots.get(part.key) ?? ('other' as const),
    }))
    const said = figures.parts.map(
      (part) =>
        `${part.line ? words.lineLabel(dimension, part.line) : t('analytics.rail.rest')} ${share(part.share)}`,
    )
    return {
      ...standing('ready', words.lineLabel(dimension, first.line)),
      leadDetail: first.line.value ? words.valueDetail(dimension, first.line.value) : undefined,
      leadRuns: words.lineRuns(dimension, first.line),
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
