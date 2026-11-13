/**
 * The values of a breakdown as the rows of a ranked chart, wherever one stands — a section's bars
 * or a card of first values: each row its value's name, its whole id where the name is its start,
 * its figure in the measure, and what pressing it does (`useLineMarks`). A task's row is a link
 * to its card, followed as any reference is; a value the read can filter by narrows the view to
 * it, sent to `narrow` with its name.
 */
import { computed } from 'vue'

import { useLineMarks } from '@/pages/analytics/composables/useLineActions.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { measureOf } from '@/pages/analytics/utils/usageFigures.ts'
import type { SpendingLine } from '@/pages/analytics/utils/usageFigures.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { UsageDimension } from '@/shared/api/analyticsApi.ts'
import type { RankedRow } from '@/shared/ui/chartGeometry.ts'

export function useRankedLines(options: {
  by: () => UsageDimension
  lines: () => readonly SpendingLine[]
  measure: () => Measure
  /** What a row carries besides, such as its hue. */
  more?: (line: SpendingLine) => Partial<RankedRow>
  /** A value pressed to narrow the view to it: its filter value, and its name. */
  narrow: (value: string | null, label: string) => void
}) {
  const words = useSpendingWords()
  const marks = useLineMarks(options)

  const rows = computed<RankedRow[]>(() =>
    options.lines().map((line) => {
      const label = words.lineLabel(options.by(), line)
      return {
        key: line.key,
        label,
        detail: words.valueDetail(options.by(), line.value),
        value: measureOf(options.measure(), line.spent) ?? 0,
        valueText: words.lineFigure(options.measure(), line.spent),
        ...options.more?.(line),
        ...marks.markOf(line, label),
      }
    }),
  )

  return { follow: marks.follow, rows, select: marks.select }
}
