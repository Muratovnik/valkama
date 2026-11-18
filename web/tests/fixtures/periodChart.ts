/** The data the period chart's tests draw: three accounts, a period of them, the chart's words. */
import type { PeriodColumn, PeriodSeries, PeriodWords } from '@/shared/ui/chartGeometry.ts'

export const series: PeriodSeries[] = [
  { key: 'a', label: 'Account A', slot: 1 },
  { key: 'b', label: 'Account B', slot: 2 },
  { key: 'c', label: 'Account C', slot: 3 },
]
export const column = (
  key: string,
  values: PeriodColumn['values'],
  incomplete = false,
): PeriodColumn => ({
  key,
  label: key,
  values,
  ...(incomplete ? { incomplete } : {}),
})
export const words: PeriodWords = {
  total: 'total',
  incomplete: 'so far',
  hatch: 'in progress',
  period: 'Day',
  note: 'Note',
  empty: 'Nothing',
}
