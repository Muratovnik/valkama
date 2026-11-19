/**
 * The order of the rows of a section's table (`SectionTable`). A column's heading sorts by it: a
 * column of names A to Z first and any other largest first, then the other way. The sort a person
 * chose holds while its column stands, and the table's first sort stands otherwise. A row with no
 * value in the column comes after every value whichever way it runs, words are compared as the
 * page's language orders them, and rows that tie keep the order they were given in.
 */
import { computed, ref } from 'vue'

/** How a sorted column's heading says so: its ARIA sort and its arrow. */
export interface SortMark {
  aria: 'ascending' | 'descending'
  icon: 'arrow-down' | 'arrow-up'
}

/** A column the rows sort by: its key, and whether it sorts A to Z first, as names do. */
interface SortColumn {
  key: string
  ascendingFirst?: boolean
}

export function useColumnSort<L>(options: {
  /** Every column a heading sorts by. */
  columns: () => readonly SortColumn[]
  /** The column the rows sort by until a person chooses one, the way that column sorts first. */
  first: () => string
  lines: () => readonly L[]
  locale: () => string
  /** A row's value in a column: a figure, words, or null for none. */
  value: (line: L, column: string) => number | string | null
}) {
  const chosen = ref<{ column: string; descending: boolean } | null>(null)

  const firstWay = (key: string) =>
    !options.columns().find((column) => column.key === key)?.ascendingFirst

  const sort = computed(() => {
    const held = chosen.value
    const stands = held && options.columns().some(({ key }) => key === held.column)
    const first = options.first()
    return stands ? held : { column: first, descending: firstWay(first) }
  })

  /** Sorts by a column: the other way when it already is, else its first way. */
  function sortBy(column: string) {
    const { column: now, descending } = sort.value
    chosen.value =
      now === column
        ? { column, descending: !descending }
        : { column, descending: firstWay(column) }
  }

  const collator = computed(() => new Intl.Collator(options.locale()))

  const lines = computed(() => {
    const { column, descending } = sort.value
    const way = descending ? -1 : 1
    return [...options.lines()].sort((left, right) => {
      const one = options.value(left, column)
      const other = options.value(right, column)
      if (one === other) return 0
      if (one === null || other === null) return one === null ? 1 : -1
      if (typeof one === 'number' && typeof other === 'number') return way * (one - other)
      return way * collator.value.compare(String(one), String(other))
    })
  })

  /** The mark of the sorted column, by its key; the other columns have none. */
  const marks = computed<Partial<Record<string, SortMark>>>(() => {
    const { column, descending } = sort.value
    const mark: SortMark = descending
      ? { aria: 'descending', icon: 'arrow-down' }
      : { aria: 'ascending', icon: 'arrow-up' }
    return { [column]: mark }
  })

  return { sort, sortBy, lines, marks }
}
