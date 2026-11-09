import type { Ref } from 'vue'

import { useEventListener } from '@vueuse/core'

/**
 * Whether taking a block out of the list now would move something from under the reader.
 *
 * Everything after a block in the list rises by its height when it goes. So the block stays
 * while the pointer or the keyboard is in it or anywhere after it in the list, and may go while
 * both are above it, outside the list or out of the window. The pointer is where it was last
 * seen, under a finger as under a mouse: a finger lifted off a phone's glass is still where the
 * person is looking.
 */
export function useUnderReader(list: Ref<HTMLElement | null>) {
  let spot: { x: number; y: number } | null = null
  const see = (event: PointerEvent) => {
    spot = { x: event.clientX, y: event.clientY }
  }
  useEventListener(document, 'pointermove', see, { capture: true, passive: true })
  useEventListener(document, 'pointerdown', see, { capture: true, passive: true })
  useEventListener(window, 'pointerout', (event: PointerEvent) => {
    if (!event.relatedTarget) spot = null
  })

  return function movesUnderReader(block: Element | null | undefined) {
    const root = list.value
    if (!block || !root) return false
    const reached = [document.activeElement, spot && document.elementFromPoint(spot.x, spot.y)]
    return reached.some(
      (node) =>
        node instanceof Node &&
        root.contains(node) &&
        (block.contains(node) ||
          Boolean(block.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)),
    )
  }
}
