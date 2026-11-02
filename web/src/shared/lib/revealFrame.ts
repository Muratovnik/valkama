/**
 * Brings a block into view by its first line, under whatever the scroller keeps over
 * its top. A block taller than the view can stand with its top cut off and still count
 * as seen, so its first child is asked for too, and the second call only ever goes up.
 */
export function revealFrame(frame: Element | null | undefined) {
  frame?.scrollIntoView?.({ block: 'nearest' })
  frame?.firstElementChild?.scrollIntoView?.({ block: 'nearest' })
}
