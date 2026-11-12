/**
 * The rows of a long list that stand in and about its scrolled window, and gap
 * rows that hold the height of the rest.
 *
 * A list of some fifteen hundred rows drew, styled and laid out every one of
 * them and then stood frozen for most of a second. From `WINDOW_FROM` rows a
 * list draws only its window, and the gaps keep the scroll bar as long as the
 * whole list. A shorter list draws every row (`useStagedRows.ts`), and so does
 * a printed one, since a page cannot scroll.
 *
 * The window is `@tanstack/vue-virtual`'s. It measures each row it draws, since
 * rows differ in height, and estimates the rest. Some rows stay drawn wherever
 * the window is: the ones the caller pins, which are the Tab stop and the row
 * focus is in, and, collapsed, the row with each column's widest value
 * (`widestRows.ts`), so the columns keep their widths while the list scrolls.
 *
 * Where a row stands, found by its id, and the scroll that brings a row into
 * view live here and nowhere else, so whatever moves through the whole list —
 * the keys today (`useListKeys.ts`) — goes by the list rather than by the rows
 * drawn.
 *
 * The table says how many rows it has and each drawn row where it stands, so a
 * screen reader announces a row's place in the whole list. What the window
 * costs for now: find in page and a screen reader's browse mode reach only the
 * rows drawn.
 */
import { computed, onMounted, shallowRef } from 'vue'
import type { Ref } from 'vue'

import { defaultRangeExtractor, useVirtualizer } from '@tanstack/vue-virtual'
import type { Range } from '@tanstack/vue-virtual'
import { useEventListener, useResizeObserver } from '@vueuse/core'

import { useStagedRows } from '@/widgets/work-item-views/composables/useStagedRows.ts'
import { widestRows } from '@/widgets/work-item-views/utils/widestRows.ts'
import type { WidthColumn } from '@/widgets/work-item-views/utils/widestRows.ts'

/** A list this long draws only the rows in and about its window. */
const WINDOW_FROM = 300
/** A row's height before it is drawn: about the mean of a long space's rows. */
const ROW_ESTIMATE = 64
/** Rows drawn past each edge of the window, so a scroll finds them painted. */
const OVERSCAN = 12

/**
 * One row of the table body: a row of the list, or a gap standing for the rows
 * not drawn, which a reader is not told of. A row the window placed carries
 * where it stands in the list, as `index` for the window that measures it and as
 * `rowIndex` for a reader, the head being the table's first row; a list drawn
 * whole, or a row drawn only for its widths, carries neither.
 */
export type ListEntry<Row> =
  | {
      height: number
      hidden: true
      key: string
      kind: 'gap'
      index?: undefined
      rowIndex?: undefined
    }
  | { key: string; kind: 'row'; row: Row; hidden?: undefined; index?: number; rowIndex?: number }

interface WindowRows<Row> {
  columns: readonly WidthColumn<Row>[]
  /** The element that scrolls the rows; the table and its head are inside it. */
  root: Readonly<Ref<HTMLElement | null>>
  key: (row: Row) => string
  /** The ids of the rows drawn wherever the window is. */
  pinned: () => readonly (string | undefined)[]
  rows: () => readonly Row[]
}

/** The room the bottom edge and the sticky head take from a scroll into view. */
interface Edges {
  end: number
  /** Where the body starts in the scrolled content, under the head. */
  margin: number
  start: number
}

export function useWindowRows<Row>({ columns, key, pinned, root, rows }: WindowRows<Row>) {
  const printing = shallowRef(false)
  useEventListener(globalThis, 'beforeprint', () => {
    printing.value = true
  })
  useEventListener(globalThis, 'afterprint', () => {
    printing.value = false
  })
  const windowed = computed(() => !printing.value && rows().length >= WINDOW_FROM)

  const places = computed(() => new Map(rows().map((row, at) => [key(row), at])))
  /** Where a row stands in the list, drawn or not; -1 for a row it does not hold. */
  const placeOf = (id: string) => places.value.get(id) ?? -1

  const edges = shallowRef<Edges>({ end: 0, margin: 0, start: 0 })
  function measureEdges() {
    const element = root.value
    const body = element?.querySelector('tbody')
    if (!element || !body) return
    const style = getComputedStyle(element)
    // The head covers as much as it is tall, which can be more than the
    // stylesheet's room for it: the first row would scroll a pixel under it.
    const next = {
      end: Number.parseFloat(style.scrollPaddingBottom) || 0,
      margin: body.offsetTop,
      start: Math.max(Number.parseFloat(style.scrollPaddingTop) || 0, body.offsetTop),
    }
    const now = edges.value
    if (next.end !== now.end || next.margin !== now.margin || next.start !== now.start) {
      edges.value = next
    }
  }
  useResizeObserver(() => root.value?.querySelector('thead') ?? null, measureEdges)

  const kept = computed(() =>
    pinned()
      .map((id) => (id === undefined ? -1 : placeOf(id)))
      .filter((at) => at >= 0),
  )

  const virtualizer = useVirtualizer<HTMLElement, HTMLTableRowElement>(
    computed(() => {
      const all = rows()
      const always = kept.value
      const { end, margin, start } = edges.value
      return {
        count: windowed.value ? all.length : 0,
        enabled: windowed.value,
        estimateSize: () => ROW_ESTIMATE,
        getItemKey: (index: number) => {
          const row = all[index]
          return row === undefined ? index : key(row)
        },
        getScrollElement: () => root.value,
        overscan: OVERSCAN,
        rangeExtractor: (range: Range) =>
          [...new Set([...defaultRangeExtractor(range), ...always])].sort((a, b) => a - b),
        scrollMargin: margin,
        scrollPaddingEnd: end,
        scrollPaddingStart: start,
      }
    }),
  )

  const held = computed(() =>
    windowed.value ? (widestRows(rows(), columns) ?? new Set<Row>()) : new Set<Row>(),
  )

  const staged = useStagedRows<Row>({ columns, root: () => root.value, rows })
  // A short list draws its first frame, and the rest right after it.
  onMounted(() => {
    if (!windowed.value) staged.stage()
  })

  const layout = computed(() => {
    const all = rows()
    if (!windowed.value) {
      const whole = staged.rows.value.map((row): ListEntry<Row> => ({
        key: key(row),
        kind: 'row',
        row,
      }))
      return { collapsed: null, entries: whole }
    }
    const instance = virtualizer.value
    const entries: ListEntry<Row>[] = []
    const drawn = new Set<Row>()
    let end = instance.options.scrollMargin
    for (const item of instance.getVirtualItems()) {
      const row = all[item.index]
      if (row === undefined) continue
      if (item.start > end) {
        entries.push({
          height: item.start - end,
          hidden: true,
          key: `gap:${item.key}`,
          kind: 'gap',
        })
      }
      entries.push({ index: item.index, key: key(row), kind: 'row', row, rowIndex: item.index + 2 })
      drawn.add(row)
      end = item.end
    }
    const total = instance.getTotalSize()
    if (total > end)
      entries.push({ height: total - end, hidden: true, key: 'gap:end', kind: 'gap' })
    const collapsed = new Set([...held.value].filter((row) => !drawn.has(row)))
    for (const row of collapsed) entries.push({ key: key(row), kind: 'row', row })
    return { collapsed, entries }
  })

  return {
    count: () => rows().length,
    /** The rows of the table for a reader, the head's included, where some are not drawn. */
    rowCount: computed(() => (windowed.value ? rows().length + 1 : undefined)),
    entries: computed(() => layout.value.entries),
    /** A row's height: measured where it was drawn and estimated where not. */
    heightAt: (index: number): number =>
      windowed.value
        ? (virtualizer.value.measurementsCache[index]?.size ?? ROW_ESTIMATE)
        : ((root.value?.querySelector('tbody')?.children[index] as HTMLElement | undefined)
            ?.offsetHeight ?? 0),
    /** A row drawn only for the widths it gives its columns. */
    held: (row: Row) => layout.value.collapsed?.has(row) ?? staged.held(row),
    idAt: (index: number) => {
      const row = rows()[index]
      return row === undefined ? undefined : key(row)
    },
    placeOf,
    /**
     * Hands a drawn row to the window, which measures it for as long as it stays
     * drawn. A row the window did not place, which carries no index, is not its.
     */
    measure: (element: unknown) => {
      const placed = element instanceof HTMLTableRowElement && element.dataset.index !== undefined
      virtualizer.value.measureElement(placed ? element : null)
    },
    /**
     * Scrolls the row at `index` into view where the window places the rows, and
     * says so; a list drawn whole leaves that to the focus that follows.
     */
    reveal(index: number): boolean {
      if (!windowed.value) return false
      virtualizer.value.scrollToIndex(index)
      return true
    },
  }
}
