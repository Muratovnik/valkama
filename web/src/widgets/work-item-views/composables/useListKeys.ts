/**
 * How the list's rows answer the keyboard and the pointer.
 *
 * Each row's reference is its one focusable control, and the rows are one Tab
 * stop: the row last focused while it is still listed, otherwise the first, held
 * by item so it follows a row a sort moved. ↑ and ↓ walk the rows, Home and End
 * go to the ends, and Page Down and Page Up move focus a screen of rows at a
 * time: left to the browser, they scrolled the rows and left focus on one
 * scrolled out of sight, so the next arrow jumped back to where the page had
 * been.
 *
 * The keys move by a row's place in the whole list, not among the rows drawn: a
 * long list draws only its window (`useWindowRows.ts`), and End goes to its last
 * row, wherever that is. The row reached becomes the Tab stop, which keeps it
 * drawn; where the window placed it, the window scrolls to it, and the focus that
 * follows once it is drawn does not scroll again.
 *
 * A click anywhere in a row opens its card, as Enter on its reference does,
 * except a click that ends a text selection, so a title can still be copied,
 * and a click on the folded facts, which are read rather than followed.
 */
import { computed, nextTick, shallowRef } from 'vue'
import type { Ref } from 'vue'

import { useEventListener } from '@vueuse/core'

const OPENER = '.list-open'

/** The list's rows by place, drawn or not. */
interface ListRows {
  count: () => number
  heightAt: (index: number) => number
  idAt: (index: number) => string | undefined
  /** Where the row of an id stands; -1 for one the list does not hold. */
  placeOf: (id: string) => number
  /** Scroll the row at a place into view, and say so; false leaves that to focus. */
  reveal: (index: number) => boolean
}

function within(event: Event, selector: string): HTMLElement | null {
  const target = event.target as Partial<Element> | null
  return target?.closest?.<HTMLElement>(selector) ?? null
}

/** Whether the click finished a drag that selected text. */
function selecting(): boolean {
  const selection = globalThis.getSelection?.()
  return Boolean(selection && !selection.isCollapsed && selection.toString() !== '')
}

/** The place about a screen away, and at least the next one. */
function paged(rows: ListRows, from: number, down: boolean, screen: number): number | null {
  const step = down ? 1 : -1
  const count = rows.count()
  let reached: number | null = null
  let travelled = 0
  for (let next = from + step; next >= 0 && next < count; next += step) {
    reached = next
    travelled += rows.heightAt(next)
    if (travelled >= screen) break
  }
  return reached
}

/**
 * `list` is read when a key or the Tab stop needs it, not before: the list keeps
 * drawn the rows this names in `kept`, so it is made after this.
 */
export function useListKeys(
  root: Ref<HTMLElement | null>,
  list: () => ListRows,
  open: (reference: string) => void,
) {
  /** The row last focused by its reference, and the row focus is in now. */
  const active = shallowRef<string | null>(null)
  const entered = shallowRef<string | null>(null)
  const stop = computed(() =>
    active.value !== null && list().placeOf(active.value) >= 0 ? active.value : list().idAt(0),
  )

  const openerOf = (id: string) =>
    root.value?.querySelector<HTMLElement>(`${OPENER}[data-id="${CSS.escape(id)}"]`) ?? null

  function reach(index: number) {
    const id = list().idAt(index)
    if (id === undefined) return
    active.value = id
    // A row the window placed is focused once it is drawn as one: it may not be
    // drawn yet, or drawn collapsed for its widths, which takes no focus.
    if (list().reveal(index)) void nextTick(() => openerOf(id)?.focus({ preventScroll: true }))
    else openerOf(id)?.focus()
  }

  function screen(): number {
    const element = root.value
    const head = element?.querySelector('thead')?.offsetHeight ?? 0
    return Math.max(0, (element?.clientHeight ?? 0) - head)
  }

  /** Where a key moves focus from a place; null where it has nowhere to go. */
  function target(event: KeyboardEvent, from: number): number | null | undefined {
    const last = list().count() - 1
    if (event.key === 'PageDown' || event.key === 'PageUp') {
      return paged(list(), from, event.key === 'PageDown', screen())
    }
    return {
      ArrowDown: from < last ? from + 1 : null,
      ArrowUp: from > 0 ? from - 1 : null,
      End: last,
      Home: 0,
    }[event.key]
  }

  useEventListener(root, 'keydown', (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const id = within(event, OPENER)?.dataset.id
    const from = id === undefined ? -1 : list().placeOf(id)
    if (from < 0) return
    const next = target(event, from)
    if (next === undefined) return
    event.preventDefault()
    if (next !== null) reach(next)
  })

  useEventListener(root, 'focusin', (event: FocusEvent) => {
    const id = within(event, OPENER)?.dataset.id
    if (id !== undefined) active.value = id
    const row = within(event, 'tbody tr')?.querySelector<HTMLElement>(OPENER)?.dataset.id
    if (row !== undefined) entered.value = row
  })

  useEventListener(root, 'click', (event: MouseEvent) => {
    const direct = within(event, OPENER)
    // The facts folded under a title are part of the row, and the whole row opens it.
    if (!direct && selecting()) return
    const opener = direct ?? within(event, 'tbody tr')?.querySelector<HTMLElement>(OPENER)
    const reference = opener?.dataset.reference
    if (reference === undefined) return
    // Focus first, so that closing the card brings it back to this row.
    if (!direct) opener?.focus({ preventScroll: true })
    open(reference)
  })

  return {
    /**
     * The rows to keep drawn wherever the list scrolls: the row last focused and
     * the row focus is in. The Tab stop is one of them or the list's first row.
     */
    kept: (): (string | undefined)[] => [active.value ?? undefined, entered.value ?? undefined],
    tabStop: (id: string): 0 | -1 => (id === stop.value ? 0 : -1),
  }
}
