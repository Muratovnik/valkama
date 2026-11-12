/**
 * The order of the rows of a dimension's table (`useTableModel`). A column's heading sorts by it,
 * largest first, then the other way; the names sort A to Z first. The sort a person chose holds
 * while its column stands, and the table's first sort — the chosen measure, or a crossed table's
 * total — stands otherwise. A row with no figure in the column comes after every figure whichever
 * way it runs, and rows that tie keep the order the model gave them.
 */
import { computed, ref } from 'vue'
import type { ComputedRef } from 'vue'

import type { TableModel } from '@/pages/analytics/composables/useTableModel.ts'

/** The key the column of names sorts by. */
export const NAME_COLUMN = 'name'

/** How a sorted column's heading says so: its ARIA sort and its arrow. */
interface SortMark {
  aria: 'ascending' | 'descending'
  icon: 'arrow-down' | 'arrow-up'
}

export function useTableSort(model: ComputedRef<TableModel>, locale: () => string) {
  const chosen = ref<{ column: string; descending: boolean } | null>(null)

  const sort = computed(() => {
    const held = chosen.value
    const stands =
      held &&
      (held.column === NAME_COLUMN || model.value.columns.some(({ key }) => key === held.column))
    return stands ? held : { column: model.value.firstSort, descending: true }
  })

  /** Sorts by a column: the other way when it already is, else its first way. */
  function sortBy(column: string) {
    const { column: now, descending } = sort.value
    chosen.value =
      now === column
        ? { column, descending: !descending }
        : { column, descending: column !== NAME_COLUMN }
  }

  const collator = computed(() => new Intl.Collator(locale()))

  const lines = computed(() => {
    const { column, descending } = sort.value
    const all = model.value.lines
    const way = descending ? -1 : 1
    if (column === NAME_COLUMN)
      return [...all].sort((left, right) => way * collator.value.compare(left.name, right.name))
    const at = model.value.columns.findIndex(({ key }) => key === column)
    return [...all].sort((left, right) => {
      const one = left.cells[at]?.sort ?? null
      const other = right.cells[at]?.sort ?? null
      if (one === other) return 0
      if (one === null || other === null) return one === null ? 1 : -1
      return way * (one - other)
    })
  })

  /** The way the rows run, by the words that name it: by size, or by name. */
  const direction = computed(() => {
    const { column, descending } = sort.value
    if (column === NAME_COLUMN) return descending ? 'za' : 'az'
    return descending ? 'down' : 'up'
  })

  /** The mark of the sorted column, by its key; the other columns have none. */
  const marks = computed<Partial<Record<string, SortMark>>>(() => {
    const { column, descending } = sort.value
    const mark: SortMark = descending
      ? { aria: 'descending', icon: 'arrow-down' }
      : { aria: 'ascending', icon: 'arrow-up' }
    return { [column]: mark }
  })

  return { sort, sortBy, lines, direction, marks }
}
