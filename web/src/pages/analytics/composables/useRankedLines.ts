/**
 * The values of a breakdown as the rows of a ranked chart, wherever one stands — a section's bars
 * or a card of first values: each row its value's name, its whole id where the name is its start,
 * its figure in the measure, and what pressing it does (`useLineActions`). A task's row is a link
 * to its card, followed as any reference is; a value the read can filter by narrows the view to
 * it, sent to `narrow` with its name.
 */
import { computed } from 'vue'

import { useLineActions } from '@/pages/analytics/composables/useLineActions.ts'
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
  const actions = useLineActions()

  const byKey = computed(() => new Map(options.lines().map((line) => [line.key, line])))

  /** What pressing a line does, as a row carries it: where it leads, or what it narrows to. */
  function acting(line: SpendingLine, label: string): Partial<RankedRow> {
    const href = actions.taskLink(options.by(), line.value)?.href
    if (href) return { href }
    if (actions.narrowsTo(options.by(), line.value) === undefined) return {}
    return { actionable: true, action: actions.narrowName(options.by(), line.value, label) }
  }

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
        ...acting(line, label),
      }
    }),
  )

  /** A row's link pressed: the task opened, in place where the page answers it. */
  function follow(key: string, event: MouseEvent) {
    const link = actions.taskLink(options.by(), byKey.value.get(key)?.value ?? null)
    if (link) actions.follow(link, event)
  }

  /** A row pressed to narrow the view to its value. */
  function select(key: string) {
    const line = byKey.value.get(key)
    const value = actions.narrowsTo(options.by(), line?.value ?? null)
    if (line && value !== undefined) options.narrow(value, words.lineLabel(options.by(), line))
  }

  return { follow, rows, select }
}
