/**
 * Where a focus a script places leaves the page. The browser shows what it focuses by
 * centring it, across as well as down, and in a frame that scrolls sideways that took the
 * reader's place away: opening the board's folded column at a phone's width gave focus to the
 * button that folds it again, which stood past the frame's end, and the board slid 441px, the
 * tiles' links off the screen. Holding the frame where it stood instead left that button, and
 * its ring, past the frame's end, so the reader saw only that the strip was gone.
 *
 * So a focus the app places goes through `placeFocus`, and a bare `focus()` in the app's
 * source is refused by lint: across, every box around its target that the reader can scroll
 * moves only as far as it must to show the target and its ring, by the nearest edge, and not
 * at all when it is already in sight (`showAcross`); up and down it is shown as the browser
 * shows it, so a landing below the fold is scrolled to. A box that clips without a scroll
 * stays where it stood. An element that already had focus, or did not take it, scrolls
 * nothing, as with the browser. What the focus handlers scroll themselves stands: they run
 * before this measures. A focus that names `preventScroll` scrolls for itself and is passed on
 * untouched. The ring is the one every scripted focus gets (`pressFocus`). A walk the reader
 * makes with the arrows goes across the same way (`walkFocus`).
 *
 * A library's own focus and the browser's are left as the platform makes them.
 */

/** The boxes around `node` that scroll across, each with where it stands now. */
function scrolledAcross(node: Element): [Element, number][] {
  const held: [Element, number][] = []
  for (let box = node.parentElement; box !== null; box = box.parentElement)
    if (box.scrollWidth > box.clientWidth) held.push([box, box.scrollLeft])
  return held
}

/** A box the reader can scroll across themselves, as against one that only clips. */
function scrollable(box: Element): boolean {
  const { overflowX } = getComputedStyle(box)
  return overflowX === 'auto' || overflowX === 'scroll'
}

const pixels = (value: string) => Number.parseFloat(value) || 0

/** How far past its box the ring `node` draws now reaches; nothing when it draws none. */
function ringReach(node: Element): number {
  if (!node.matches(':focus-visible')) return 0
  const style = getComputedStyle(node)
  return style.outlineStyle === 'none'
    ? 0
    : Math.max(0, pixels(style.outlineWidth) + pixels(style.outlineOffset))
}

/**
 * How far a box must scroll to show the span `from`..`to` in its room `start`..`end`, as the
 * platform's nearest edge does (CSSOM View, `scrollIntoView`): nothing for a span in sight or
 * one that covers the room; a span past one edge comes to that edge, and one wider than the
 * room to the edge that keeps the most of it in sight.
 */
function nearest(from: number, to: number, start: number, end: number): number {
  const wider = to - from > end - start
  if (from < start && to > end) return 0
  if ((from < start && !wider) || (to > end && wider)) return from - start
  if ((from < start && wider) || (to > end && !wider)) return to - end
  return 0
}

/**
 * Brings `node`, `reach` px clear at either side, into every box around it the reader can
 * scroll across, innermost first, by the nearest edge (`nearest`). The box's own
 * `scroll-padding` is the room it keeps at its edges.
 */
export function showAcross(node: Element, reach = 0): void {
  for (let box = node.parentElement; box !== null; box = box.parentElement) {
    if (box.scrollWidth <= box.clientWidth || !scrollable(box)) continue
    const style = getComputedStyle(box)
    const left = box.getBoundingClientRect().left + box.clientLeft
    const shown = node.getBoundingClientRect()
    box.scrollLeft += nearest(
      shown.left - reach,
      shown.right + reach,
      left + pixels(style.scrollPaddingLeft),
      left + box.clientWidth - pixels(style.scrollPaddingRight),
    )
  }
}

/** Chromium's own showing of a focus: left alone in sight, centred out of it, edged in part. */
type ShownIfNeeded = Element & { scrollIntoViewIfNeeded?: (centre?: boolean) => void }

/**
 * Shows `node` up and down as the browser's focus would, and across by the nearest edge. By
 * the nearest edge up and down instead, the row a page key reached in the list ran past the
 * list's end, its reference shown and its lower part cut; a browser without Chromium's call
 * takes the nearest edge all the same.
 */
function show(node: ShownIfNeeded) {
  const held = scrolledAcross(node)
  if (node.scrollIntoViewIfNeeded) node.scrollIntoViewIfNeeded(true)
  else node.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  for (const [box, left] of held) if (box.scrollLeft !== left) box.scrollLeft = left
  showAcross(node, ringReach(node))
}

/** Focuses `target`, if there is one, and shows it across by the nearest edge (`showAcross`). */
export function placeFocus(
  target: HTMLElement | SVGElement | null | undefined,
  options?: FocusOptions,
): void {
  if (!target) return
  if (options?.preventScroll) {
    target.focus(options)
    return
  }
  const before = document.activeElement
  target.focus({ ...options, preventScroll: true })
  if (before !== target && document.activeElement === target) show(target)
}
