import type { Ref } from 'vue'

import { useEventListener } from '@vueuse/core'

/** The air left between what has focus and the edge that would have covered it. */
const CLEARANCE = 8

/** The nearest box that scrolls this element, or the page's own. */
function scrollerOf(element: HTMLElement): Element | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight)
      return node
  }
  return document.scrollingElement
}

/**
 * Keeps what takes focus inside `root` clear of the parts of it that stick to an edge of the
 * panel scrolling it: a long form's head at the top (`data-stuck-edge="start"`) and its foot at
 * the bottom (`"end"`). A browser brings what takes focus into the panel, and a stuck part is
 * inside the panel, so the browser takes the element for shown while the stuck part covers it
 * (WCAG 2.4.11). Focus arrives after the browser's own scroll; what is still covered then is
 * moved clear by as much as it is covered. What is inside a stuck part is never covered by it.
 */
export function useUncoveredFocus(root: Ref<HTMLElement | null>) {
  useEventListener(root, 'focusin', ({ target }: FocusEvent) => {
    if (!(target instanceof HTMLElement) || !root.value) return
    const edges = [...root.value.querySelectorAll<HTMLElement>('[data-stuck-edge]')].filter(
      (edge) => !edge.contains(target),
    )
    if (!edges.length) return
    const box = target.getBoundingClientRect()
    let by = 0
    for (const edge of edges) {
      const rect = edge.getBoundingClientRect()
      if (box.bottom <= rect.top || box.top >= rect.bottom) continue
      by =
        edge.dataset.stuckEdge === 'end'
          ? Math.max(by, box.bottom - rect.top + CLEARANCE)
          : Math.min(by, box.top - rect.bottom - CLEARANCE)
    }
    if (by) scrollerOf(target)?.scrollBy({ top: by })
  })
}
