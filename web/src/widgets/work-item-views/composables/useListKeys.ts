/**
 * How the list's rows answer the keyboard and the pointer.
 *
 * Each row's reference is its one focusable control, and the rows are one Tab
 * stop. ↑ and ↓ walk the rows, Home and End go to the ends, and Page Down and
 * Page Up move focus a screen of rows at a time: left to the browser, they
 * scrolled the rows and left focus on one scrolled out of sight, so the next
 * arrow jumped back to where the page had been.
 *
 * A click anywhere in a row opens its card, as Enter on its reference does,
 * except a click that ends a text selection, so a title can still be copied,
 * and a click on the folded facts, which are read rather than followed.
 */
import type { Ref } from 'vue'

import { useEventListener } from '@vueuse/core'

const OPENER = '.list-open'

function within(event: Event, selector: string): HTMLElement | null {
  const target = event.target as Partial<Element> | null
  return target?.closest?.<HTMLElement>(selector) ?? null
}

/** Whether the click finished a drag that selected text. */
function selecting(): boolean {
  const selection = globalThis.getSelection?.()
  return Boolean(selection && !selection.isCollapsed && selection.toString() !== '')
}

function step(row: Element, down: boolean): Element | null {
  return down ? row.nextElementSibling : row.previousElementSibling
}

/** The row about a screen away, and at least the next one. */
function paged(row: Element, down: boolean, screen: number): Element | null {
  let reached: Element | null = null
  let travelled = 0
  for (let next = step(row, down); next; next = step(next, down)) {
    reached = next
    travelled += (next as HTMLElement).offsetHeight
    if (travelled >= screen) break
  }
  return reached
}

export function useListKeys(
  root: Ref<HTMLElement | null>,
  handlers: { focus: (id: string) => void; open: (reference: string) => void },
) {
  function screen(): number {
    const list = root.value
    const head = list?.querySelector('thead')?.offsetHeight ?? 0
    return Math.max(0, (list?.clientHeight ?? 0) - head)
  }

  function target(event: KeyboardEvent, row: Element, body: Element): Element | null | undefined {
    if (event.key === 'PageDown' || event.key === 'PageUp') {
      return paged(row, event.key === 'PageDown', screen())
    }
    return {
      ArrowDown: row.nextElementSibling,
      ArrowUp: row.previousElementSibling,
      End: body.lastElementChild,
      Home: body.firstElementChild,
    }[event.key]
  }

  useEventListener(root, 'keydown', (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const row = within(event, OPENER)?.closest('tr')
    const body = row?.parentElement
    if (!row || !body) return
    const next = target(event, row, body)
    if (next === undefined) return
    event.preventDefault()
    next?.querySelector<HTMLElement>(OPENER)?.focus()
  })

  useEventListener(root, 'focusin', (event: FocusEvent) => {
    const id = within(event, OPENER)?.dataset.id
    if (id !== undefined) handlers.focus(id)
  })

  useEventListener(root, 'click', (event: MouseEvent) => {
    const direct = within(event, OPENER)
    if (!direct && (selecting() || within(event, '.list-facts'))) return
    const opener = direct ?? within(event, 'tbody tr')?.querySelector<HTMLElement>(OPENER)
    const reference = opener?.dataset.reference
    if (reference === undefined) return
    // Focus first, so that closing the card brings it back to this row.
    if (!direct) opener?.focus({ preventScroll: true })
    handlers.open(reference)
  })
}
