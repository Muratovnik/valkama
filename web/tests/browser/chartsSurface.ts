/**
 * The harness page for the two chart primitives and their tables, drawn with the product
 * stylesheet at whatever width the test sets: names long enough to wrap, a month of days with a
 * change and a day still running, a day of hours that opens by the hour, and an empty chart.
 * What a press sent is written into one line, so a test reads the event the way a page would
 * receive it.
 */
import { h, ref } from 'vue'

import { seriesSlots } from '@/shared/lib/seriesColors.ts'
import type {
  PeriodColumn,
  PeriodSelection,
  PeriodSeries,
  PeriodWords,
  RankedRow,
  RankedWords,
} from '@/shared/ui/chartGeometry.ts'
import PeriodColumns from '@/shared/ui/PeriodColumns.vue'
import PeriodColumnsTable from '@/shared/ui/PeriodColumnsTable.vue'
import RankedBars from '@/shared/ui/RankedBars.vue'
import RankedBarsTable from '@/shared/ui/RankedBarsTable.vue'

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
const series: PeriodSeries[] = ['personal', 'work', 'ci'].map((key) => ({
  key,
  label: key === 'ci' ? 'ci (automation)' : key,
  slot: accountSlots.get(key) ?? 'other',
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

const hours: PeriodColumn[] = Array.from({ length: 24 }, (_, hour) => ({
  key: `h${hour}`,
  label: `${String(hour).padStart(2, '0')}:00`,
  values: hour < 8 || hour > 21 ? {} : { work: (hour * 7) % 45, ci: (hour * 11) % 15 },
  ...(hour === 23 ? { incomplete: true } : {}),
}))

const periodWords: PeriodWords = {
  total: 'total',
  incomplete: 'so far',
  period: 'Day',
  note: 'Note',
  empty: 'No sessions in this range.',
}

const marks = [{ at: '2026-10-12', label: 'Switched to the work account' }]

const section = (name: string, children: ReturnType<typeof h>[]) =>
  h('section', { 'class': 'charts-harness-section', 'data-harness': name }, children)

export function chartsSurface() {
  const selected = ref('')
  const onRow = (key: string) => {
    selected.value = `row ${key}`
  }
  const onPeriod = (selection: PeriodSelection) => {
    selected.value = `period ${selection.column} ${selection.series ?? '-'}`
  }
  const periodProps = { series, words: periodWords, formatValue: minutes }
  return () =>
    h('main', { 'class': 'charts-harness', 'data-harness': 'charts' }, [
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
          actionable: 'segment',
          onSelect: onPeriod,
        }),
      ]),
      section('hours', [
        h(PeriodColumns, {
          ...periodProps,
          label: 'Time per hour',
          columns: hours,
          series: series.slice(1),
          actionable: 'column',
          onSelect: onPeriod,
        }),
      ]),
      section('empty', [
        h(PeriodColumns, { ...periodProps, label: 'Nothing yet', columns: [] }),
        h(RankedBars, { label: 'Nothing ranked', rows: [], words: rankedWords }),
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
          actionable: 'segment',
          onSelect: onPeriod,
        }),
      ]),
    ])
}
