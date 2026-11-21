/**
 * Where a focus a script places leaves the page. The browser shows what it focuses by
 * centring it, across as well as down, and in a frame that scrolls sideways that took the
 * reader's place away: opening the board's folded column at a phone's width gave focus to the
 * button that folds it again, which stood past the frame's end, and the board slid 441px, the
 * tiles' links off the screen.
 *
 * So a focus the app places goes through `placeFocus`, and a bare `focus()` in the app's
 * source is refused by lint: it leaves every box around its target that scrolls across where
 * it stood, and shows the target up and down as the browser shows it, so a landing below the
 * fold is scrolled to. An element that already had focus, or did not take it, scrolls nothing,
 * as with the browser. What the focus handlers scroll themselves stands: they run before this
 * measures. A focus that names `preventScroll` scrolls for itself and is passed on untouched.
 * The ring is the one every scripted focus gets (`pressFocus`). A walk the reader makes with
 * the arrows does go across, to the edge it needs and no further (`walkFocus`).
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

/** Chromium's own showing of a focus: left alone in sight, centred out of it, edged in part. */
type ShownIfNeeded = Element & { scrollIntoViewIfNeeded?: (centre?: boolean) => void }

/**
 * Shows `node` up and down as the browser's focus would, every scroll across left as it
 * stands. By the nearest edge instead, the row a page key reached in the list ran past the
 * list's end, its reference shown and its lower part cut; a browser without Chromium's call
 * takes the nearest edge all the same.
 */
function showAlong(node: ShownIfNeeded) {
  const held = scrolledAcross(node)
  if (node.scrollIntoViewIfNeeded) node.scrollIntoViewIfNeeded(true)
  else node.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  for (const [box, left] of held) if (box.scrollLeft !== left) box.scrollLeft = left
}

/** Focuses `target`, if there is one, leaving the frames that scroll across where they stood. */
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
  if (before !== target && document.activeElement === target) showAlong(target)
}
