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

/** How far what has focus must move to stand clear of the stuck parts of `root`, or 0. */
function coveredBy(root: HTMLElement, target: HTMLElement) {
  const edges = [...root.querySelectorAll<HTMLElement>('[data-stuck-edge]')].filter(
    (edge) => !edge.contains(target) && !target.contains(edge),
  )
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
  return by
}

/**
 * Keeps what takes focus inside `root` clear of the parts of it that stick to an edge of the
 * panel scrolling it: a block's head at the top of the list of everything waiting and a long
 * form's head at the top (`data-stuck-edge="start"`), and its foot at the bottom (`"end"`). A
 * browser brings what takes focus into the panel, and a stuck part is inside the panel, so the
 * browser takes the element for shown while the stuck part covers it (WCAG 2.4.11). What is
 * covered when focus arrives is moved clear by as much as it is covered, and asked again on the
 * next frame: Shift+Tab onto the last button of a block whose head the block's end had pushed up
 * over it reached it before the browser's own scroll, which then left it under that head. What
 * is inside a stuck part is never covered by it, and neither is what holds one: the question as
 * a whole, which the app takes focus to, would otherwise be scrolled until its foot stood clear
 * of itself.
 */
export function useUncoveredFocus(root: Ref<HTMLElement | null>) {
  const clear = (target: HTMLElement) => {
    if (!root.value || document.activeElement !== target) return
    const by = coveredBy(root.value, target)
    if (by) scrollerOf(target)?.scrollBy({ top: by })
  }
  useEventListener(root, 'focusin', ({ target }: FocusEvent) => {
    if (!(target instanceof HTMLElement)) return
    clear(target)
    requestAnimationFrame(() => clear(target))
  })
}
