/**
 * The order of the rows of a dimension's table (`useTableModel`), as a section's table sorts its
 * rows (`useColumnSort`): a column's heading sorts by it, largest first, then the other way; the
 * names sort A to Z first. The table's first sort is the chosen measure, or a crossed table's
 * total. A row with no figure in the column comes after every figure whichever way it runs.
 */
import { computed } from 'vue'
import type { ComputedRef } from 'vue'

import type { TableModel } from '@/pages/analytics/composables/useTableModel.ts'

import { useColumnSort } from '@/widgets/section-table/composables/useColumnSort.ts'

/** The key the column of names sorts by. */
export const NAME_COLUMN = 'name'

export function useTableSort(model: ComputedRef<TableModel>, locale: () => string) {
  const { sort, sortBy, lines, marks } = useColumnSort({
    columns: () => [{ key: NAME_COLUMN, ascendingFirst: true }, ...model.value.columns],
    first: () => model.value.firstSort,
    lines: () => model.value.lines,
    locale,
    value: (line, column) => {
      if (column === NAME_COLUMN) return line.name
      const at = model.value.columns.findIndex(({ key }) => key === column)
      return line.cells[at]?.sort ?? null
    },
  })

  /** The way the rows run, by the words that name it: by size, or by name. */
  const direction = computed(() => {
    const { column, descending } = sort.value
    if (column === NAME_COLUMN) return descending ? 'za' : 'az'
    return descending ? 'down' : 'up'
  })

  return { sort, sortBy, lines, direction, marks }
}
