/**
 * How a list's rows answer the keyboard and the pointer.
 *
 * What holds focus in a row is the one thing a caller says (`ListFocus`). A flat
 * list is a table whose rows each hold one focusable control, the reference's
 * button (`.list-open`). A tree is a `treegrid`, and there focus stands on the
 * row itself, as the WAI-ARIA pattern for one has it: → opens a folded row and
 * otherwise goes into the row's cells, ← folds an open row and otherwise goes to
 * its parent, and in the cells ← and → go from one to the next, ← from the
 * first back to the row. Enter on a row or a cell opens the card.
 *
 * The rows are one Tab stop: the row last focused while it is still shown,
 * otherwise, in a tree, the nearest ancestor of it shown, and otherwise the
 * first, held by id so it follows a row a sort moved. ↑ and ↓ walk the rows,
 * Home and End go to the ends, and Page Down and Page Up move focus a screen of
 * rows at a time: left to the browser, they scrolled the rows and left focus on
 * one scrolled out of sight, so the next arrow jumped back to where the page had
 * been.
 *
 * The keys move by a row's place in the whole list, not among the rows drawn: a
 * long list draws only its window (`useWindowRows.ts`), and End goes to its last
 * row, wherever that is. The row reached becomes the Tab stop, which keeps it
 * drawn; where the window placed it, the window scrolls to it, and the focus that
 * follows once it is drawn does not scroll again.
 *
 * A click anywhere in a row opens its card, as Enter does, except a click that
 * ends a text selection, so a title can still be copied, and a click on a tree
 * row's arrow, which folds or opens it (`toggle`). Folding a row that holds the
 * row focus is in moves focus to the row folded, so focus is never left on a
 * row that went.
 */
import { computed, nextTick, shallowRef } from 'vue'
import type { Ref } from 'vue'

import { useEventListener } from '@vueuse/core'

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

/** What a tree tells the keys about its rows. */
interface TreeKeys {
  /** Whether a row is open; null where it has nothing to open. */
  expanded: (id: string) => boolean | null
  /** A row's parent; null at the top level. */
  parentOf: (id: string) => string | null
  /** Fold an open row or open a folded one. */
  toggle: (id: string) => void
}

/**
 * What holds focus in a row: the reference's button in a flat list, the row
 * itself in a tree. Each element that does carries `data-id` and
 * `data-reference`.
 */
export type ListFocus = { kind: 'opener' } | { kind: 'row'; tree: TreeKeys }

const OPENER = '.list-open'
const ROW = 'tbody tr[data-id]'

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

/** The cell beside a cell of a row, or null at the row's edge. */
function besideCell(cell: HTMLElement, forward: boolean): HTMLElement | null {
  const next = forward ? cell.nextElementSibling : cell.previousElementSibling
  return next instanceof HTMLElement ? next : null
}

/**
 * `list` is read when a key or the Tab stop needs it, not before: the list keeps
 * drawn the rows this names in `kept`, so it is made after this.
 */
export function useListKeys(
  root: Ref<HTMLElement | null>,
  list: () => ListRows,
  open: (reference: string) => void,
  focus: ListFocus,
) {
  const tree = focus.kind === 'row' ? focus.tree : null
  const target = tree ? ROW : OPENER

  /** The row last focused by its id, and the row focus is in now. */
  const active = shallowRef<string | null>(null)
  const entered = shallowRef<string | null>(null)

  /** The row of `id`, or in a tree its nearest ancestor shown. */
  function shownFrom(id: string): string | undefined {
    for (let at: string | null = id; at !== null; at = tree?.parentOf(at) ?? null)
      if (list().placeOf(at) >= 0) return at
    return undefined
  }
  const stop = computed(() => (active.value === null ? undefined : shownFrom(active.value)))
  const tabStopId = computed(() => stop.value ?? list().idAt(0))

  const targetOf = (id: string) =>
    root.value?.querySelector<HTMLElement>(`${target}[data-id="${CSS.escape(id)}"]`) ?? null

  function reach(index: number) {
    const id = list().idAt(index)
    if (id === undefined) return
    active.value = id
    // A row the window placed is focused once it is drawn as one: it may not be
    // drawn yet, or drawn collapsed for its widths, which takes no focus.
    if (list().reveal(index)) void nextTick(() => targetOf(id)?.focus({ preventScroll: true }))
    else targetOf(id)?.focus()
  }

  function screen(): number {
    const element = root.value
    const head = element?.querySelector('thead')?.offsetHeight ?? 0
    return Math.max(0, (element?.clientHeight ?? 0) - head)
  }

  /** Where a key moves focus from a place; null where it has nowhere to go. */
  function step(key: string, from: number): number | null | undefined {
    const last = list().count() - 1
    if (key === 'PageDown' || key === 'PageUp') {
      return paged(list(), from, key === 'PageDown', screen())
    }
    return {
      ArrowDown: from < last ? from + 1 : null,
      ArrowUp: from > 0 ? from - 1 : null,
      End: last,
      Home: 0,
    }[key]
  }

  /**
   * Fold or open a tree's row. Where focus is in the list, it goes to that row:
   * the row focus was on may be under it and gone with the fold, and an arrow
   * pressed keeps no focus of its own.
   */
  function toggle(id: string) {
    if (!tree) return
    const inList = root.value?.contains(document.activeElement) ?? false
    tree.toggle(id)
    if (!inList) return
    active.value = id
    void nextTick(() => targetOf(id)?.focus({ preventScroll: true }))
  }

  /** ← and → on a tree's row and in its cells; true where the key was the tree's. */
  function treeKey(event: KeyboardEvent, row: HTMLElement, id: string): boolean {
    if (!tree || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return false
    const forward = event.key === 'ArrowRight'
    const cell = event.target === row ? null : within(event, 'td')
    if (cell) {
      const next = besideCell(cell, forward) ?? (forward ? null : row)
      next?.focus()
      return true
    }
    const expanded = tree.expanded(id)
    if (forward && expanded === false) toggle(id)
    else if (forward) row.querySelector<HTMLElement>('td')?.focus()
    else if (expanded === true) toggle(id)
    else {
      const parent = tree.parentOf(id)
      const place = parent === null ? -1 : list().placeOf(parent)
      if (place >= 0) reach(place)
    }
    return true
  }

  useEventListener(root, 'keydown', (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const holder = within(event, target)
    const id = holder?.dataset.id
    const from = id === undefined ? -1 : list().placeOf(id)
    if (!holder || id === undefined || from < 0) return
    if (treeKey(event, holder, id)) {
      event.preventDefault()
      return
    }
    if (tree && event.key === 'Enter') {
      event.preventDefault()
      const reference = holder.dataset.reference
      if (reference !== undefined) open(reference)
      return
    }
    const next = step(event.key, from)
    if (next === undefined) return
    event.preventDefault()
    if (next !== null) reach(next)
  })

  useEventListener(root, 'focusin', (event: FocusEvent) => {
    const id = within(event, target)?.dataset.id
    if (id !== undefined) active.value = id
    const row = within(event, 'tbody tr')
    const held = tree ? row?.dataset.id : row?.querySelector<HTMLElement>(OPENER)?.dataset.id
    if (held !== undefined) entered.value = held
  })

  useEventListener(root, 'click', (event: MouseEvent) => {
    const direct = tree ? null : within(event, OPENER)
    // The facts folded under a title are part of the row, and the whole row opens it.
    if (!direct && selecting()) return
    const row = within(event, 'tbody tr')
    const holder =
      direct ?? (tree ? within(event, ROW) : row?.querySelector<HTMLElement>(OPENER)) ?? null
    const reference = holder?.dataset.reference
    if (reference === undefined) return
    // Focus first, so that closing the card brings it back to this row.
    if (!direct) holder?.focus({ preventScroll: true })
    open(reference)
  })

  return {
    /**
     * The rows to keep drawn wherever the list scrolls: the row last focused,
     * the row focus is in, and the Tab stop, which is one of them, an ancestor
     * of the first in a tree, or the list's first row.
     */
    kept: (): (string | undefined)[] => [
      active.value ?? undefined,
      entered.value ?? undefined,
      stop.value,
    ],
    tabStop: (id: string): 0 | -1 => (id === tabStopId.value ? 0 : -1),
    toggle,
  }
}
