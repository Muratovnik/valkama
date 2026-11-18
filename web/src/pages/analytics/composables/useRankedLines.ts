/**
 * The values of a breakdown as the rows of a ranked chart, wherever one stands — a section's bars
 * or a card of first values: each row its value's name, what the name leaves out (`valueDetail`),
 * its figure in the measure, and what pressing it does (`useLineMarks`): a value the read can
 * filter by opens its side panel, sent to `inspect` with its name, and a task's row is a link to
 * its card as well, which a press with a modifier or the middle button opens elsewhere.
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
  /** A value pressed to open its side panel: its filter value, and its name. */
  inspect: (value: string | null, label: string) => void
  lines: () => readonly SpendingLine[]
  measure: () => Measure
  /** What a row carries besides, such as its hue. */
  more?: (line: SpendingLine) => Partial<RankedRow>
}) {
  const words = useSpendingWords()
  const marks = useLineMarks(options)

  const rows = computed<RankedRow[]>(() =>
    options.lines().map((line) => {
      const label = words.lineLabel(options.by(), line)
      return {
        key: line.key,
        label,
        labelEnd: words.lineEnd(line),
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
