/**
 * The harness page for the chart primitives and their tables, drawn with the product
 * stylesheet at whatever width the test sets: names long enough to wrap, a month of days with a
 * change and a day still running whose accounts but the automation one act, a day of hours that
 * opens by the hour, an empty chart, and a
 * week of small multiples whose longest name is cut to one line; and the two small charts a tile
 * draws, a trend and a share bar, at a tile's width on its ground. A window of a limit in every
 * state its bar draws — a range ahead of the share spent, past the whole, a fresh nothing with a
 * tail ahead, silent, running out before the reset, no figure, and thin in a tile — on the
 * panel's ground, with a window's readings as a step line past which its forecast runs, and both
 * as their tables, and a window read at its reset whose readings stand minutes apart
 * (`windowCases`).
 * What a press sent is written into one line, so a test reads the event the way a page would
 * receive it; the window's one hint host shows each mark's hint, as the app's does.
 */
import { h, ref } from 'vue'

import { seriesSlots } from '@/shared/lib/seriesColors.ts'
import type { SeriesSlot } from '@/shared/lib/seriesColors.ts'
import type {
  PeriodColumn,
  PeriodSeries,
  PeriodWords,
  RankedRow,
  RankedWords,
} from '@/shared/ui/chartGeometry.ts'
import MiniShareBar from '@/shared/ui/MiniShareBar.vue'
import MiniTrend from '@/shared/ui/MiniTrend.vue'
import type {
  MultiplePeriod,
  MultiplesWords,
  SmallMultiple,
} from '@/shared/ui/multiplesGeometry.ts'
import PeriodColumns from '@/shared/ui/PeriodColumns.vue'
import PeriodColumnsTable from '@/shared/ui/PeriodColumnsTable.vue'
import RankedBars from '@/shared/ui/RankedBars.vue'
import RankedBarsTable from '@/shared/ui/RankedBarsTable.vue'
import SmallMultiples from '@/shared/ui/SmallMultiples.vue'
import SmallMultiplesTable from '@/shared/ui/SmallMultiplesTable.vue'
import StepLine from '@/shared/ui/StepLine.vue'
import StepLineTable from '@/shared/ui/StepLineTable.vue'
import TooltipHost from '@/shared/ui/TooltipHost.vue'
import WindowBar from '@/shared/ui/WindowBar.vue'
import WindowBarTable from '@/shared/ui/WindowBarTable.vue'

import {
  stepAhead,
  stepCloseProps,
  stepPoints,
  stepProps,
  stepWords,
  windowBars,
  windowRows,
  windowWords,
} from './windowCases.ts'

const minutes = (value: number) =>
  value >= 60
    ? `${Math.floor(value / 60)} h ${String(value % 60).padStart(2, '0')} min`
    : `${value} min`

const projects = ['core', 'web', 'docs', 'example-project-with-a-rather-long-repository-identifier']
const slots = seriesSlots(projects)

const rankedRows: RankedRow[] = [
  { key: 'core', label: 'core', value: 754, actionable: true },
  { key: 'web', label: 'web', value: 391, actionable: true },
  {
    key: 'example-project-with-a-rather-long-repository-identifier',
    label: 'example-project-with-a-rather-long-repository-identifier',
    value: 248,
    actionable: true,
  },
  {
    key: 'docs',
    label: 'A project whose name runs over more than one line where the column is narrow',
    value: 37,
  },
  { key: 'other', label: 'Other (5 projects)', value: 96, kind: 'other' as const },
  { key: 'none', label: 'No task', value: 512, kind: 'none' as const, actionable: true },
  { key: 'unknown', label: 'Unknown', value: 4, kind: 'unknown' as const },
].map((row) => ({ ...row, valueText: minutes(row.value), slot: slots.get(row.key) }))

const rankedWords: RankedWords = {
  category: 'Project',
  value: 'Time',
  empty: 'No time recorded in this range.',
}

const accountSlots = seriesSlots(['ci', 'personal', 'work'])
/** Each account narrows to itself but the automation one, whose segments only show. */
const series: PeriodSeries[] = ['personal', 'work', 'ci'].map((key) => ({
  key,
  label: key === 'ci' ? 'ci (automation)' : key,
  slot: accountSlots.get(key) ?? 'other',
  ...(key === 'ci' ? {} : { actionable: true, action: `Show the work of ${key}` }),
}))

/** A month of days in a fixed pattern, the last one still running. */
const days: PeriodColumn[] = Array.from({ length: 30 }, (_, index) => {
  const day = index + 1
  const weekend = index % 7 >= 5
  return {
    key: `2026-10-${String(day).padStart(2, '0')}`,
    label: `Oct ${day}`,
    fullLabel: `October ${day}`,
    values: weekend
      ? { personal: (index * 13) % 50 }
      : {
          personal: 40 + ((index * 37) % 90),
          work: 120 + ((index * 53) % 200),
          ci: (index * 29) % 60,
        },
    ...(day === 30 ? { incomplete: true } : {}),
  }
})

/** The hours stack work nobody can place too, in the neutral a ranked chart no longer draws. */
const hourSeries: PeriodSeries[] = [
  ...series.slice(1),
  { key: 'unknown', label: 'Unknown', slot: 'other' },
]

const hours: PeriodColumn[] = Array.from({ length: 24 }, (_, hour) => ({
  key: `h${hour}`,
  label: `${String(hour).padStart(2, '0')}:00`,
  action: `Show ${String(hour).padStart(2, '0')}:00`,
  values:
    hour < 8 || hour > 21
      ? {}
      : { work: (hour * 7) % 45, ci: (hour * 11) % 15, unknown: hour % 3 ? 0 : 6 },
  ...(hour === 23 ? { incomplete: true } : {}),
}))

const periodWords: PeriodWords = {
  total: 'total',
  incomplete: 'so far',
  hatch: 'in progress',
  period: 'Day',
  note: 'Note',
  empty: 'No sessions in this range.',
}

const marks = [{ at: '2026-10-12', label: 'Switched to the work account' }]

/** The month's days as a trend: what each day's stack adds up to, a day with no figure among them. */
const trend = days.map((day, index) => ({
  key: day.key,
  value:
    index === 3 ? null : Object.values(day.values).reduce<number>((sum, one = 0) => sum + one, 0),
  ...(day.incomplete ? { incomplete: true } : {}),
}))

/** Three projects' shares of a whole and what they leave out, which the neutral draws. */
const shares = [
  { key: 'core', share: 0.5 },
  { key: 'web', share: 0.26 },
  { key: 'docs', share: 0.04 },
].map((part) => ({ ...part, slot: slots.get(part.key) ?? ('other' as SeriesSlot) }))
const parts = [...shares, { key: 'rest', share: 0.2, slot: 'other' as const }]

/** A week of days, for the small multiples. */
const week: MultiplePeriod[] = Array.from({ length: 7 }, (_, index) => ({
  key: `2026-10-${String(index + 24).padStart(2, '0')}`,
  label: `Oct ${index + 24}`,
}))

/**
 * Small multiples of the projects over the week: core's 240 minutes on the fourth day is the
 * largest period on the shared scale, docs has a day with no figure, the folded tail shares the
 * scale, and work with no task and unknown work stand apart, with 600 minutes that set nothing.
 */
/** A multiple's figure for the week: its days added up, a day with no figure adding nothing. */
function weekTotal(values: readonly (number | null)[]) {
  let total = 0
  for (const value of values) if (value !== null) total += value
  return total
}

const projectWeeks: (Pick<SmallMultiple, 'key' | 'kind' | 'values'> & { label?: string })[] = [
  { key: 'core', values: [60, 120, 90, 240, 30, 0, 0] },
  { key: 'web', values: [30, 45, 60, 20, 10, 0, 5] },
  {
    key: 'example-project-with-a-rather-long-repository-identifier',
    values: [10, 0, 20, 40, 60, 0, 0],
  },
  { key: 'docs', values: [5, null, 15, 0, 10, 0, 0] },
  { key: 'other', label: 'Other (5 projects)', values: [20, 10, 30, 10, 20, 5, 0], kind: 'other' },
  { key: 'none', label: 'No task', values: [600, 0, 0, 0, 0, 0, 0], kind: 'none' },
  { key: 'unknown', label: 'Unknown', values: [0, 4, 0, 0, 0, 0, 0], kind: 'unknown' },
]
const multiples: SmallMultiple[] = projectWeeks.map((one) => ({
  ...one,
  label: one.label ?? one.key,
  valueText: minutes(weekTotal(one.values)),
  slot: slots.get(one.key) ?? 'other',
}))

const multiplesWords: MultiplesWords = {
  category: 'Project',
  empty: 'No time recorded in this range.',
  scale: 'Every chart from 0 to',
  total: 'Week',
  absent: 'No figure',
}

const section = (name: string, children: ReturnType<typeof h>[], ground?: 'canvas') =>
  h(
    'section',
    { 'class': 'charts-harness-section', 'data-harness': name, 'data-ground': ground },
    children,
  )

export function chartsSurface() {
  const selected = ref('')
  const onRow = (key: string) => {
    selected.value = `row ${key}`
  }
  const onPeriod = (key: string) => {
    selected.value = `period ${key}`
  }
  const onSeries = (key: string) => {
    selected.value = `series ${key}`
  }
  const periodProps = {
    series,
    words: periodWords,
    formatValue: minutes,
    formatShare: (ratio: number) => `${Math.round(ratio * 100)}% of the day`,
    onPeriod,
    onSeries,
  }
  return () =>
    h('main', { 'class': 'charts-harness', 'data-harness': 'charts' }, [
      // The one hint host the app mounts, which every mark's hint shows through.
      h(TooltipHost),
      h(
        'output',
        { 'class': 'charts-harness-selected', 'data-harness': 'selected' },
        selected.value,
      ),
      section('ranked', [
        h(RankedBars, {
          label: 'Time by project',
          rows: rankedRows,
          words: rankedWords,
          onSelect: onRow,
        }),
      ]),
      section('days', [
        h(PeriodColumns, {
          ...periodProps,
          label: 'Time per day by account',
          columns: days,
          marks,
        }),
      ]),
      section('hours', [
        h(PeriodColumns, {
          ...periodProps,
          label: 'Time per hour',
          columns: hours,
          series: hourSeries,
        }),
      ]),
      section('empty', [
        h(PeriodColumns, { ...periodProps, label: 'Nothing yet', columns: [] }),
        h(RankedBars, { label: 'Nothing ranked', rows: [], words: rankedWords }),
      ]),
      section('mini', [
        h('div', { class: 'charts-harness-mini' }, [
          h(MiniTrend, {
            label: 'Time per day in October, the last day so far',
            points: trend,
          }),
          h(MiniShareBar, {
            label: 'Shares of time: core 50%, web 26%, docs 4%, the rest 20%',
            parts,
          }),
          h(MiniShareBar, { label: 'Shares of time: no data', parts: [] }),
        ]),
      ]),
      section('ranked-table', [
        h(RankedBarsTable, {
          label: 'Time by project',
          rows: rankedRows,
          words: rankedWords,
          onSelect: onRow,
        }),
      ]),
      section('days-table', [
        h(PeriodColumnsTable, {
          ...periodProps,
          label: 'Time per day by account',
          columns: days,
          marks,
        }),
      ]),
      section('multiples', [
        h(SmallMultiples, {
          label: 'Time per day of each project',
          multiples,
          words: multiplesWords,
          formatValue: minutes,
        }),
      ]),
      section(
        'window',
        [
          h('div', { class: 'charts-harness-windows' }, [
            ...windowBars.map((bar) => h(WindowBar, bar)),
            h('div', { class: 'charts-harness-mini' }, [
              h(WindowBar, {
                'label':
                  'Week: 74% used, steady use 70%, fresh. Forecast · By the reset: 86% to 95%',
                'used': 74,
                'even': 70,
                'forecast': { low: 86, high: 95 },
                'compact': true,
                'data-case': 'compact',
              }),
            ]),
          ]),
        ],
        'canvas',
      ),
      section(
        'window-table',
        [h(WindowBarTable, { label: 'Windows of Work', rows: windowRows, words: windowWords })],
        'canvas',
      ),
      section('step', [h(StepLine, stepProps)], 'canvas'),
      section('step-close', [h(StepLine, stepCloseProps)], 'canvas'),
      section(
        'step-table',
        [
          h(StepLineTable, {
            label: 'Readings of the five hours',
            points: stepPoints,
            words: stepWords,
            forecast: stepAhead.forecast,
          }),
        ],
        'canvas',
      ),
      section('multiples-table', [
        h(SmallMultiplesTable, {
          label: 'Time per day of each project',
          multiples,
          periods: week,
          words: multiplesWords,
          formatValue: minutes,
        }),
      ]),
    ])
}
