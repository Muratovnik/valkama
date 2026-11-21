import { recordInput, ringAsked } from '@/shared/lib/pressFocus.ts'

/**
 * Every focus a script places passes through one wrap of the browser's `focus()`, the app's
 * own and a library's alike, put on once at the start, so a caller cannot leave out its rules.
 *
 * The ring: a focus after a press of the pointer is not ringed unless it asks to be
 * (`ringAsked` in `pressFocus`).
 *
 * The place: a focus leaves every box around it that scrolls across where it stood. The
 * browser shows what it focuses by centring it, and in a frame that scrolls sideways that
 * took the reader's place away: opening the board's folded column at a phone's width gave
 * focus to the button that folds it again, which stood past the frame's end, and the board
 * slid 441px, the tiles' links off the screen. Up and down it is still shown as the browser
 * shows it, so a landing below the fold is scrolled to; an element that already had focus, or
 * did not take it, scrolls nothing, as with the browser. What the focus handlers scroll
 * themselves stands: they run before the wrap measures. A focus that names `preventScroll`
 * scrolls for itself and is left alone. A walk the reader makes with the arrows does go
 * across, to the edge it needs and no further (`walkFocus`).
 */
let installed = false

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

export function installScriptedFocus(): void {
  if (installed) return
  installed = true
  recordInput()
  for (const prototype of [HTMLElement.prototype, SVGElement.prototype]) {
    const focus = Object.getOwnPropertyDescriptor(prototype, 'focus')?.value as unknown
    if (typeof focus !== 'function') continue
    prototype.focus = function (this: HTMLElement | SVGElement, options?: FocusOptions) {
      const asked = ringAsked(this, options)
      if (options?.preventScroll) {
        Reflect.apply(focus, this, [asked])
        return
      }
      const before = document.activeElement
      Reflect.apply(focus, this, [{ ...asked, preventScroll: true }])
      if (before !== this && document.activeElement === this) showAlong(this)
    }
  }
}
